"""Resolve creation policy across the knowledge catalog and research intake."""

from collections.abc import Callable
from uuid import UUID

from qunxue_api.modules.knowledge_catalog import KnowledgeCatalog, KnowledgeUsePurpose
from qunxue_api.modules.research_intake import (
    EntryType,
    ProjectLifecycleStatus,
    ResearchCentralTool,
    ResearchEntryMode,
    ResearchTask,
    ResearchTaskService,
)


class SeedTheoryNotInCurrentRelease(Exception):
    """The requested seed could not be resolved in the current browse release."""


class ResearchTaskCreationCommand:
    def __init__(
        self,
        service: ResearchTaskService,
        catalog: Callable[[], KnowledgeCatalog],
    ) -> None:
        # The caller retains the existing service transaction boundary.
        self._service = service
        self._catalog = catalog

    def create(
        self,
        *,
        user_id: UUID,
        entry_type: EntryType,
        idempotency_key: str,
        entry_mode: ResearchEntryMode = ResearchEntryMode.FROM_SCRATCH,
        project_title: str | None = None,
        project_stage: str | None = None,
        method_orientation: str | None = None,
        seed_theory_id: str | None = None,
    ) -> ResearchTask:
        seed_theory_name = None
        if seed_theory_id is not None:
            catalog = self._catalog()
            release = catalog.current_release(purpose=KnowledgeUsePurpose.BROWSE)
            try:
                seed_theory_name = catalog.get_theory_profile(
                    theory_id=seed_theory_id,
                    release_id=release.knowledge_release_id,
                ).title
            except LookupError as error:
                raise SeedTheoryNotInCurrentRelease from error
        return self._service.create(
            user_id=user_id,
            entry_type=entry_type,
            idempotency_key=idempotency_key,
            entry_mode=entry_mode,
            lifecycle_status=(
                ProjectLifecycleStatus.IN_PROGRESS
                if entry_mode is ResearchEntryMode.EXISTING_RESEARCH
                else ProjectLifecycleStatus.DRAFT
            ),
            project_title=project_title or seed_theory_name or "未命名研究",
            project_stage=project_stage,
            method_orientation=method_orientation,
            last_central_tool=(
                ResearchCentralTool.MATERIALS
                if entry_mode is ResearchEntryMode.EXISTING_RESEARCH
                else ResearchCentralTool.PHENOMENON
            ),
            seed_theory_id=seed_theory_id,
            seed_theory_name=seed_theory_name,
        )
