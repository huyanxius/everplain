"""Offline, exact-source review of the D02 retrieval-storage compatibility edge.

This script only creates synthetic SQLite in a temporary directory. It never
imports the product application, reads configuration, or contacts a provider.
"""
import argparse
import ast
import hashlib
import importlib.util
import json
import sqlite3
import struct
import sys
import tempfile
from dataclasses import asdict
from pathlib import Path

PREVIOUS_INDEX_SHA256 = "d45eafd7c931a47a9c8f6731d563c8030202abf0f135390a978b8c919b36dcc3"
CURRENT_INDEX_SHA256 = "69163cb24b5f83cc550beebcaaf7516861a61c6d108b6a0965d03481364a5ec9"
PREVIOUS_STORAGE = "2110b33f141d037084bf093bc663b0f228965cf9f25c91d668a8c8deba103e86"
CURRENT_STORAGE = "28146d4e4db089ae8aeaf0cc59462bbf393cbb3ea19a07edfdbb8ea7b5af72d2"
INDEX_PATH = "backend/src/qunxue_api/adapters/retrieval/sqlite_index.py"


def digest(value):
    return hashlib.sha256(value).hexdigest()


def json_hash(value):
    return digest(json.dumps(value, sort_keys=True).encode())


def storage(root):
    values = {
        "migrations/" + p.relative_to(root / "backend/migrations").as_posix():
        digest(p.read_bytes())
        for p in sorted((root / "backend/migrations").rglob("*.py"))
    }
    values["schema/sqlite_index.py"] = digest((root / INDEX_PATH).read_bytes())
    return values


def definitions(path):
    source = path.read_text()
    values = {}
    for item in ast.parse(source).body:
        if isinstance(item, ast.ClassDef) and item.name == "SqliteRetrievalIndex":
            for method in item.body:
                if isinstance(method, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    values[f"{item.name}.{method.name}"] = ast.get_source_segment(source, method)
        elif isinstance(item, (ast.ClassDef, ast.FunctionDef)):
            values[item.name] = ast.get_source_segment(source, item)
    return values


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def cell(value):
    if isinstance(value, bytes):
        return ["blob", value.hex()]
    if isinstance(value, str):
        return ["text", value.encode().hex()]
    return [type(value).__name__, value]


def snapshot(path):
    with sqlite3.connect(path) as connection:
        schema = list(connection.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name"
        ))
        rows = {}
        pragmas = {}
        for table, order in (("retrieval_indexes", "retrieval_index_id"),
                             ("retrieval_points", "retrieval_index_id,chunk_id")):
            rows[table] = [[cell(value) for value in row] for row in connection.execute(
                f"SELECT * FROM {table} ORDER BY {order}"
            )]
            pragmas[table] = {
                "columns": list(connection.execute(f"PRAGMA table_info({table})")),
                "foreign_keys": list(connection.execute(f"PRAGMA foreign_key_list({table})")),
                "indexes": list(connection.execute(f"PRAGMA index_list({table})")),
            }
        assert list(connection.execute("PRAGMA foreign_key_check")) == []
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    return {"schema": schema, "pragmas": pragmas, "rows": rows}


def retained(before, after):
    assert before["schema"] == after["schema"]
    assert before["pragmas"] == after["pragmas"]
    for table, values in before["rows"].items():
        assert all(row in after["rows"][table] for row in values)


def build(module, index, label, *, jitter=False):
    chunks = tuple(module.RetrievalChunk(
        chunk_id=f"{label}:{number}", document_kind="synthetic", knowledge_id=f"owned:{label}",
        theory_id=None, content_version=number + 1, content_hash=f"sha256:{label}:{number}",
        title=f"中文标题{number}😀", text=f"synthetic {label} text\0保留{number}",
        source_ids=(f"source:{label}", "source:中文😀\0id"),
    ) for number in range(3))
    vectors = ((0.999, 0.001), (0.001, 0.999), (0.0, 0.0)) if jitter else (
        (1.0, 0.0), (0.0, 1.0), (0.0, 0.0),
    )
    return index.rebuild(
        knowledge_release_id=f"release:{label}", release_content_hash=f"sha256:release:{label}",
        embedding_model="synthetic-embedding", chunk_schema_version="synthetic-v1",
        chunks=chunks, vectors=vectors,
    )


def read(index, manifest):
    identity = {"retrieval_index_id": manifest.retrieval_index_id,
                "knowledge_release_id": manifest.knowledge_release_id}
    assert asdict(index.get_manifest(manifest.retrieval_index_id)) == asdict(manifest)
    chunks = [asdict(chunk) for chunk in index.list_chunks(**identity, document_kind=None)]
    hits = index.search(**identity, query_vector=(3.0, 4.0), document_kind=None, limit=3)
    assert [round(hit.score, 12) for hit in hits] == [0.8, 0.6, 0.0]
    assert len(chunks) == 3
    return chunks


def review(previous_root, current_root):
    previous_path, current_path = previous_root / INDEX_PATH, current_root / INDEX_PATH
    old_storage, new_storage = storage(previous_root), storage(current_root)
    assert old_storage["schema/sqlite_index.py"] == PREVIOUS_INDEX_SHA256
    assert new_storage["schema/sqlite_index.py"] == CURRENT_INDEX_SHA256
    assert json_hash(old_storage) == PREVIOUS_STORAGE
    assert json_hash(new_storage) == CURRENT_STORAGE
    assert {key: value for key, value in old_storage.items() if key.startswith("migrations/")} == {
        key: value for key, value in new_storage.items() if key.startswith("migrations/")
    }
    old_defs, new_defs = definitions(previous_path), definitions(current_path)
    assert new_defs.keys() - old_defs.keys() == {"_unit_vector"}
    assert old_defs.keys() - new_defs.keys() == set()
    changed = sorted(key for key in old_defs if old_defs[key] != new_defs[key])
    assert changed == ["SqliteRetrievalIndex.search", "_cosine_similarity", "_unpack_vector"]
    unchanged = {key: digest(value.encode()) for key, value in old_defs.items()
                 if value == new_defs[key]}
    old = load(previous_path, "review_old_vector_index")
    new = load(current_path, "review_new_vector_index")
    packed_cases = [(1.0, 0.0), (0.0, -0.0), (3e38, -3e38), (1e-40, -1e-40)]
    for vector in packed_cases:
        assert old._pack_vector(vector) == new._pack_vector(vector) == struct.pack("<2f", *vector)
    with tempfile.TemporaryDirectory(prefix="everplain-vector-storage-review-") as directory:
        path = Path(directory) / "synthetic-index.sqlite"
        old_index = old.SqliteRetrievalIndex(path)
        first = build(old, old_index, "old-before-upgrade")
        before = snapshot(path)
        first_chunks = read(old_index, first)
        new_index = new.SqliteRetrievalIndex(path)
        assert snapshot(path) == before
        assert read(new_index, first) == first_chunks
        assert asdict(build(new, new_index, "old-before-upgrade", jitter=True)) == asdict(first)
        assert snapshot(path) == before
        second = build(new, new_index, "new-before-rollback")
        after_new_write = snapshot(path)
        retained(before, after_new_write)
        second_chunks = read(new_index, second)
        # Actually start the old version against the same, newly written database.
        rolled_back = old.SqliteRetrievalIndex(path)
        assert snapshot(path) == after_new_write
        assert read(rolled_back, first) == first_chunks
        assert read(rolled_back, second) == second_chunks
        assert asdict(build(old, rolled_back, "new-before-rollback", jitter=True)) == asdict(second)
        assert snapshot(path) == after_new_write
        third = build(old, rolled_back, "old-after-rollback")
        after_old_write = snapshot(path)
        retained(after_new_write, after_old_write)
        third_chunks = read(rolled_back, third)
        upgraded_again = new.SqliteRetrievalIndex(path)
        assert read(upgraded_again, first) == first_chunks
        assert read(upgraded_again, second) == second_chunks
        assert read(upgraded_again, third) == third_chunks
        assert snapshot(path) == after_old_write
        result = {
            "format": 1,
            "review": "D02 query-only retrieval storage compatibility",
            "previous_index_sha256": PREVIOUS_INDEX_SHA256,
            "current_index_sha256": CURRENT_INDEX_SHA256,
            "from": PREVIOUS_STORAGE, "to": CURRENT_STORAGE,
            "migration_files_unchanged": len(old_storage) - 1,
            "migration_file_sha256": {
                k: v for k, v in old_storage.items() if k.startswith("migrations/")
            },
            "changed_definitions": changed,
            "added_definitions": ["_unit_vector"],
            "unchanged_definition_sha256": unchanged,
            "checks": {
                "schema_and_pragma_identical": True,
                "old_write_new_read": True,
                "new_write_old_start_read": True,
                "old_write_after_rollback_new_read": True,
                "accepted_rows_and_cell_bytes_retained": True,
                "ready_index_jitter_rebuild_does_not_mutate": True,
                "manifest_and_chunk_identities_unchanged": True,
                "float32_packing_identical": True,
                "searches_do_not_write": True,
                "integrity_and_foreign_keys_valid": True,
            },
            "final_index_count": len(after_old_write["rows"]["retrieval_indexes"]),
            "final_point_count": len(after_old_write["rows"]["retrieval_points"]),
            "schema_sha256": json_hash([before["schema"], before["pragmas"]]),
            "before_upgrade_rows_sha256": json_hash(before["rows"]),
            "new_version_rows_sha256": json_hash(after_new_write["rows"]),
            "after_rollback_write_rows_sha256": json_hash(after_old_write["rows"]),
            "scope": (
                "Exact storage edge only; no historical forward-only boundary, reverse edge, "
                "model behavior or deployment authority is expanded."
            ),
        }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--previous-root", required=True, type=Path)
    parser.add_argument("--current-root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    print(json.dumps(review(args.previous_root, args.current_root), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
