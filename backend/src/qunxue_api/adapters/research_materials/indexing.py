"""Import-time vector checkpoints for the existing durable material ingestion job."""

import math
from datetime import UTC, datetime

from sqlalchemy import select

from qunxue_api.adapters.research_agent.embedding import EmbeddingProviderError
from qunxue_api.adapters.retrieval import RetrievalChunk
from qunxue_api.adapters.sqlite.material_vector_cache import SqliteMaterialVectorCache
from qunxue_api.adapters.sqlite.research_material_model import ResearchMaterialBlockRow
from qunxue_api.adapters.sqlite.research_material_repository import SqliteResearchMaterialRepository
from qunxue_api.modules.research_materials import MaterialStatus, MaterialVersionConflict


def _valid_vector(vector, dimension=None):
    return (
        isinstance(vector, list)
        and bool(vector)
        and (dimension is None or len(vector) == dimension)
        and all(
            isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
            for value in vector
        )
        and any(vector)
    )


class ResearchMaterialIndexer:
    """Reuse exact content within one owned material, then embed only missing blocks.

    External calls run outside database transactions. A lease/owner/current-parse
    fence is checked again before each durable batch, including cache reuse.
    """

    def __init__(self, database, *, embedder, embedding_model):
        self._database = database
        self._embedder = embedder
        self._model = embedding_model

    def __call__(self, job):
        if self._embedder is None or not self._model:
            raise EmbeddingProviderError("embedding not configured", code="not_configured")
        with self._database.session() as session:
            repository = SqliteResearchMaterialRepository(session)
            self._fence(repository, job)
            material = repository.get(job.material_id, user_id=job.user_id, task_id=job.task_id)
            parsed = repository.get_parse(
                job.material_id, job.parse_id, user_id=job.user_id, task_id=job.task_id
            )
            if material is None or parsed is None or parsed.status is not MaterialStatus.READY:
                raise MaterialVersionConflict("material parse is no longer available")
            chunks = tuple(
                RetrievalChunk(
                    chunk_id=f"material-segment:{job.material_id}:{block.segment_id}",
                    document_kind="research_material",
                    knowledge_id=None,
                    theory_id=None,
                    content_version=parsed.version,
                    content_hash=block.content_hash,
                    title=material.display_name or material.original_filename,
                    text=block.text,
                    source_ids=(f"material-segment:{block.segment_id}",),
                )
                for block in parsed.blocks
            )
            cache = SqliteMaterialVectorCache(
                session, user_id=job.user_id, parse_ids={job.material_id: job.parse_id}
            )
            vectors = cache.get_many(chunks, self._model)
            # No sharing across materials or users, even when their bytes match.
            prior_vectors = {}
            for row in session.scalars(
                select(ResearchMaterialBlockRow).where(
                    ResearchMaterialBlockRow.material_id == str(job.material_id),
                    ResearchMaterialBlockRow.content_hash.in_({c.content_hash for c in chunks}),
                )
            ):
                vector = row.embedding_vectors.get(self._model)
                if _valid_vector(vector):
                    prior_vectors[(row.content_hash, row.text)] = vector
        dimension = next((len(v) for v in vectors if _valid_vector(v)), None)
        reused, missing = [], {}
        for chunk, vector in zip(chunks, vectors, strict=True):
            if _valid_vector(vector, dimension):
                continue
            prior = prior_vectors.get((chunk.content_hash, chunk.text))
            if _valid_vector(prior, dimension):
                dimension = dimension or len(prior)
                reused.append((chunk, prior))
            else:
                missing.setdefault((chunk.content_hash, chunk.text), []).append(chunk)
        if reused:
            self._checkpoint(job, [c for c, _ in reused], [v for _, v in reused])
        groups = list(missing.values())
        for start in range(0, len(groups), 16):
            batch = groups[start : start + 16]
            # Recheck deletion, replacement, and processing restrictions before
            # sending any new source text to the configured embedding provider.
            with self._database.session() as session:
                self._fence(SqliteResearchMaterialRepository(session), job)
            generated = self._embedder.embed_documents([items[0].text for items in batch])
            if len(generated) != len(batch):
                raise EmbeddingProviderError("embedding response count does not match blocks")
            batch_chunks, batch_vectors = [], []
            for items, vector in zip(batch, generated, strict=True):
                if not _valid_vector(vector, dimension):
                    raise EmbeddingProviderError("embedding response contains an invalid vector")
                dimension = dimension or len(vector)
                batch_chunks.extend(items)
                batch_vectors.extend([vector] * len(items))
            self._checkpoint(job, batch_chunks, batch_vectors)

    @staticmethod
    def _fence(repository, job):
        current = repository.checkpoint_ingestion(
            job.job_id,
            expected_attempt_count=job.attempt_count,
            expected_parse_id=job.parse_id,
            now=datetime.now(UTC),
        )
        if current is None or (
            current.user_id != job.user_id
            or current.task_id != job.task_id
            or current.material_id != job.material_id
        ):
            raise MaterialVersionConflict("material indexing lease or parse is no longer current")
        if not repository.is_external_model_processable(
            job.material_id, user_id=job.user_id, task_id=job.task_id
        ):
            raise EmbeddingProviderError(
                "material policy forbids external indexing", code="policy_denied"
            )

    def _checkpoint(self, job, chunks, vectors):
        with self._database.session() as session:
            self._fence(SqliteResearchMaterialRepository(session), job)
            cache = SqliteMaterialVectorCache(
                session, user_id=job.user_id, parse_ids={job.material_id: job.parse_id}
            )
            cache.put_many(chunks, self._model, vectors)
