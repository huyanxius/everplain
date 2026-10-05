import asyncio
import logging
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, asynccontextmanager, contextmanager, suppress
from datetime import UTC, datetime, timedelta
from inspect import Parameter, signature
from threading import Lock
from time import sleep
from uuid import UUID, uuid4

import httpx
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from qunxue_api.account_extension import install_account_management
from qunxue_api.adapters.commerce_config import CommerceSettings, build_model_catalog
from qunxue_api.adapters.email import ResendEmailProvider
from qunxue_api.adapters.empty_catalog import EmptyKnowledgeCatalog
from qunxue_api.adapters.import_sources.fetch import fetch_bookmark
from qunxue_api.adapters.media_import import (
    BilibiliFavoritesAdapter,
    ImageImportAdapter,
    OpenAICompatibleVisionProvider,
)
from qunxue_api.adapters.media_import.integration import MediaImportGateway, parse_files
from qunxue_api.adapters.model import (
    BuiltInCaseCatalog,
    ModelEndpoint,
    ModelGateway,
    ModelInvocationError,
    ModelProvider,
    ModelRouteExecutor,
    OpenAICompatibleModelProvider,
    ProbeableModelProvider,
    RoutedModelProvider,
    SqliteModelAttemptRecorder,
    SqliteModelInvocationRecorder,
    create_deterministic_mock_provider,
)
from qunxue_api.adapters.oauth import OAuthClients
from qunxue_api.adapters.research_agent import (
    DeterministicKnowledgeRunner,
    OpenAICompatibleEmbeddingProvider,
    OpenWebResearchClient,
    PydanticAIKnowledgeRunner,
    ResearchDocumentToolRegistry,
    SiliconFlowRerankerProvider,
)
from qunxue_api.adapters.research_agent.conversation_summarizer import (
    PydanticConversationSummarizer,
)
from qunxue_api.adapters.research_agent.course_cost import CourseCostLimits
from qunxue_api.adapters.research_agent.course_organization import (
    CourseKnowledgeGenerator,
    CourseOrganizationWorker,
)
from qunxue_api.adapters.research_agent.graph_topic_namer import GraphTopicNamer
from qunxue_api.adapters.research_agent.memory_extractor import PydanticMemoryExtractor
from qunxue_api.adapters.research_agent.memory_overview import PydanticMemoryOverview
from qunxue_api.adapters.research_agent.memory_tools import AgentMemoryTools
from qunxue_api.adapters.research_agent.pydantic_runner import AgentModelRouteError
from qunxue_api.adapters.research_agent.shared_knowledge import SharedKnowledgeReferences
from qunxue_api.adapters.research_exchange import map_published_qunxue_project
from qunxue_api.adapters.research_materials import parse_material
from qunxue_api.adapters.research_materials.doi import CrossrefDoiMetadataResolver
from qunxue_api.adapters.research_materials.indexing import ResearchMaterialIndexer
from qunxue_api.adapters.retrieval import (
    RETRIEVAL_CORPUS_SCHEMA_VERSION,
    HybridRetriever,
    SqliteRetrievalIndex,
)
from qunxue_api.adapters.security import Argon2PasswordHasher
from qunxue_api.adapters.sqlite.agent_conversation_repository import SqliteConversationRepository
from qunxue_api.adapters.sqlite.agent_memory_repository import SqliteMemoryRepository
from qunxue_api.adapters.sqlite.agent_profile import SqliteAgentProfileRepository
from qunxue_api.adapters.sqlite.billing_repository import SqliteCreditRepository
from qunxue_api.adapters.sqlite.channel_gateway import SqliteChannelGatewayRepository
from qunxue_api.adapters.sqlite.conversation_summary_repository import (
    SqliteConversationSummaryRepository,
)
from qunxue_api.adapters.sqlite.database import Database
from qunxue_api.adapters.sqlite.external_agents import SqliteExternalAgentRepository
from qunxue_api.adapters.sqlite.identity_repository import SqliteIdentityRepository
from qunxue_api.adapters.sqlite.knowledge_import import SqliteImportRepository
from qunxue_api.adapters.sqlite.material_vector_cache import SqliteMaterialVectorCache
from qunxue_api.adapters.sqlite.memory_learning_repository import SqliteMemoryLearningRepository
from qunxue_api.adapters.sqlite.oauth_transactions import OAuthTransactions
from qunxue_api.adapters.sqlite.personal_graph import SqlitePersonalGraphRepository
from qunxue_api.adapters.sqlite.phenomenon_repository import SqlitePhenomenonRepository
from qunxue_api.adapters.sqlite.professional_material_repository import (
    SqliteProfessionalMaterialRepository,
)
from qunxue_api.adapters.sqlite.research_analysis_repository import (
    SqliteResearchAnalysisRepository,
)
from qunxue_api.adapters.sqlite.research_cycle_repository import SqliteResearchCycleRepository
from qunxue_api.adapters.sqlite.research_document import (
    SqliteResearchDocumentRepository,
)
from qunxue_api.adapters.sqlite.research_document_mutation import (
    SqliteResearchDocumentMutationRepository,
)
from qunxue_api.adapters.sqlite.research_document_proposal import (
    SqliteResearchDocumentProposalRepository,
)
from qunxue_api.adapters.sqlite.research_material_repository import (
    SqliteResearchMaterialRepository,
)
from qunxue_api.adapters.sqlite.research_material_search import (
    SqliteResearchMaterialSearchRepository,
)
from qunxue_api.adapters.sqlite.research_method_repository import SqliteMethodPlanRepository
from qunxue_api.adapters.sqlite.research_project_audit import (
    SqliteResearchProjectAuditRepository,
)
from qunxue_api.adapters.sqlite.research_start_proposal import (
    SqliteResearchStartProposalRepository,
)
from qunxue_api.adapters.sqlite.research_task_repository import (
    SqliteResearchTaskRepository,
)
from qunxue_api.adapters.sqlite.shared_knowledge import SqliteSharedKnowledgeRepository
from qunxue_api.adapters.sqlite.subscriptions import SqliteSubscriptionRepository
from qunxue_api.adapters.sqlite.theory_matching import (
    SqliteMatchingRequestRepository,
    SqliteMatchRunRepository,
)
from qunxue_api.adapters.sqlite.writing import SqliteWritingRepository
from qunxue_api.adapters.stripe_subscriptions import StripeSubscriptionGateway
from qunxue_api.adapters.theory_evidence import (
    CatalogTheoryEvidenceSource,
    CatalogTheoryLexicalRetriever,
)
from qunxue_api.adapters.transcription import (
    DashScopeTranscriptionProvider,
    OpenAICompatibleTranscriptionProvider,
)
from qunxue_api.api.contracts.common import ErrorCode, ErrorDetail, ErrorResponse
from qunxue_api.api.routes.agent import router as agent_router
from qunxue_api.api.routes.agent_profile import router as agent_profile_router
from qunxue_api.api.routes.channel_gateway import router as channel_gateway_router
from qunxue_api.api.routes.commerce import router as commerce_router
from qunxue_api.api.routes.external_agents import router as external_agents_router
from qunxue_api.api.routes.health import router as health_router
from qunxue_api.api.routes.knowledge_import import router as knowledge_import_router
from qunxue_api.api.routes.memories import MemoryValidationError
from qunxue_api.api.routes.memories import router as memories_router
from qunxue_api.api.routes.oauth_session import router as oauth_session_router
from qunxue_api.api.routes.personal_graph import router as personal_graph_router
from qunxue_api.api.routes.phenomena import material_router as material_intakes_router
from qunxue_api.api.routes.phenomena import router as phenomena_router
from qunxue_api.api.routes.professional_materials import (
    router as professional_materials_router,
)
from qunxue_api.api.routes.research_analysis import router as research_analysis_router
from qunxue_api.api.routes.research_cycle import router as research_cycle_router
from qunxue_api.api.routes.research_documents import router as research_documents_router
from qunxue_api.api.routes.research_exchange import router as research_exchange_router
from qunxue_api.api.routes.research_materials import router as research_materials_router
from qunxue_api.api.routes.research_method import router as research_method_router
from qunxue_api.api.routes.research_tasks import router as research_tasks_router
from qunxue_api.api.routes.session import router as session_router
from qunxue_api.api.routes.shared_knowledge import router as shared_knowledge_router
from qunxue_api.api.routes.writing import router as writing_router
from qunxue_api.application import (
    DisciplinaryAgentApplication,
    ProfessionalMaterialsApplication,
    ResearchAnalysisApplication,
    ResearchCycleApplication,
    ResearchDocumentApplication,
    ResearchDocumentProposalApplication,
    ResearchJourney,
    ResearchJourneyDependencies,
    ResearchMaterialApplication,
    ResearchMethodPlanApplication,
    ResearchProjectExchangeApplication,
    ResearchStartApplication,
    TheoryMatchingApplication,
)
from qunxue_api.application.agent_profile import AgentProfileApplication
from qunxue_api.application.agent_research_workflow import AgentResearchWorkflow
from qunxue_api.application.channel_gateway import ChannelGatewayApplication
from qunxue_api.application.conversation_summary import ConversationSummaryWorker
from qunxue_api.application.external_agents import ExternalAgentApplication
from qunxue_api.application.knowledge_import import KnowledgeImportApplication
from qunxue_api.application.memory_learning import MemoryLearningWorker
from qunxue_api.application.memory_overview import MemoryOverview
from qunxue_api.application.oauth_login import OAuthLoginApplication
from qunxue_api.application.personal_graph import PersonalGraphApplication
from qunxue_api.application.shared_knowledge import SharedKnowledgeApplication
from qunxue_api.application.subscriptions import SubscriptionApplication
from qunxue_api.application.writing import WritingApplication, WritingPipeline
from qunxue_api.modules.agent_conversation import ConversationNotFound, ConversationService
from qunxue_api.modules.agent_memory import MemoryService
from qunxue_api.modules.billing import SIGNUP_GRANT, CreditService
from qunxue_api.modules.external_agents import ExternalAgentService
from qunxue_api.modules.identity import (
    EmailAlreadyRegistered,
    EmailDeliveryUnavailable,
    IdentityError,
    IdentityService,
    InvalidEmail,
    InvalidVerificationCode,
    OAuthClientConfiguration,
    OAuthProviderCredentials,
    Unauthenticated,
    VerificationCodeRateLimited,
)
from qunxue_api.modules.research_analysis import ResearchAnalysisService
from qunxue_api.modules.research_framework import (
    ResearchDocumentProposalService,
    ResearchDocumentService,
)
from qunxue_api.modules.research_intake import (
    PhenomenonService,
    ResearchStartIdempotencyConflict,
    ResearchStartProposalConflict,
    ResearchStartProposalNotFound,
    ResearchStartSourceIncomplete,
    ResearchTaskNotFound,
    ResearchTaskService,
)
from qunxue_api.modules.research_materials import (
    MaterialIngestionStatus,
    MaterialParseError,
)
from qunxue_api.modules.research_method import MethodPlanService
from qunxue_api.modules.shared_knowledge import (
    SharedKnowledgeForbidden,
    SharedKnowledgeService,
    SharedKnowledgeUnavailable,
    SharedKnowledgeValidationError,
)
from qunxue_api.modules.theory_matching import TheoryMatchingService
from qunxue_api.modules.transcription import (
    ProcessingLocation,
    TranscriptionProvider,
    UnavailableTranscriptionProvider,
)
from qunxue_api.modules.writing import WritingConflict, WritingUnavailable
from qunxue_api.settings import (
    KNOWLEDGE_ROOT,
    Settings,
    get_settings,
)

logger = logging.getLogger(__name__)


def _build_transcription_provider(settings: Settings) -> TranscriptionProvider:
    if not settings.has_transcription_provider:
        return UnavailableTranscriptionProvider()
    provider_type = (
        DashScopeTranscriptionProvider
        if "dashscope" in (settings.transcription_base_url or "")
        and (settings.transcription_model or "").endswith("filetrans")
        else OpenAICompatibleTranscriptionProvider
    )
    return provider_type(
        base_url=settings.transcription_base_url or "",
        api_key=(
            settings.transcription_api_key.get_secret_value()
            if settings.transcription_api_key
            else ""
        ),
        model=settings.transcription_model or "",
        processing_location=ProcessingLocation(settings.transcription_processing_location),
        timeout_seconds=settings.transcription_timeout_seconds,
    )


def oauth_client_configuration(settings: Settings) -> OAuthClientConfiguration:
    return OAuthClientConfiguration(
        origin=settings.oauth_public_origin,
        secure_session_cookie=settings.session_cookie_secure,
        providers=tuple(
            OAuthProviderCredentials(
                provider=provider,
                client_id=getattr(settings, f"oauth_{provider}_client_id"),
                client_secret=(secret.get_secret_value() if secret else None),
            )
            for provider in ("google", "github")
            for secret in (getattr(settings, f"oauth_{provider}_client_secret"),)
        ),
    )


def create_app(
    *,
    settings: Settings | None = None,
    database: Database | None = None,
    journey_dependencies: ResearchJourneyDependencies | None = None,
    model_provider: ModelProvider | None = None,
    model_probe_transport: httpx.AsyncBaseTransport | None = None,
    knowledge_retriever: HybridRetriever | None = None,
    require_email_verification: bool = True,
) -> FastAPI:
    resolved_settings = settings or get_settings()
    resolved_database = database or Database(resolved_settings.database_url)

    async def run_model_probe_loop(app: FastAPI) -> None:
        while True:
            try:
                with app.state.billing_operations.open(
                    user_id="operator:model_probe",
                    run_id=uuid4(),
                    payload={"phase": "model_probe"},
                    phase="model_probe",
                ) as scope:
                    await app.state.model_provider.probe()
                    scope.finish("success")
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("Model health probe failed.")
            await asyncio.sleep(resolved_settings.model_probe_interval_seconds)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if app.state.billing_operations.runtime:
            app.state.billing_operations.runtime.recover_stale(
                before=datetime.now(UTC) - timedelta(minutes=30),
                # Production is single-instance/single-worker. On startup no
                # prior process owns these live requests; release their wallet
                # capacity while retaining unknown provider-cost evidence.
                recover_actual_usage=True,
            )
        probe_task = None
        memory_task = None
        course_task = None

        async def process_imports():
            while True:
                worked = False
                if app.state.import_worker_enabled:
                    try:
                        worked = await asyncio.to_thread(app.state.run_import_once)
                        await asyncio.to_thread(app.state.run_graph_once)
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        logger.warning("Import processing will retry later.")
                await asyncio.sleep(0.05 if worked else 1)

        import_task = asyncio.create_task(process_imports(), name="everplain-imports")
        if resolved_settings.runtime_mode != "mock":

            async def organize_courses():
                while True:
                    try:
                        worked = await asyncio.to_thread(
                            app.state.course_organization_worker.run_once
                        )
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        logger.warning("Course processing will retry later.")
                        worked = False
                    await asyncio.sleep(0.1 if worked else 3)

            course_task = asyncio.create_task(
                organize_courses(), name="everplain-course-processing"
            )
        if app.state.model_endpoints and (
            resolved_settings.memory_learning_enabled
            or resolved_settings.conversation_summary_enabled
        ):

            async def learn_memories():
                while True:
                    try:
                        if resolved_settings.conversation_summary_enabled:
                            await asyncio.to_thread(app.state.context_summary_worker.run_once)
                        if resolved_settings.memory_learning_enabled:
                            await asyncio.to_thread(app.state.memory_worker.run_once)
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        logger.warning("Memory learning scheduler will retry later.")
                    await asyncio.sleep(60)

            memory_task = asyncio.create_task(learn_memories(), name="everplain-memory-learning")
        if app.state.model_router is not None:
            probe_task = asyncio.create_task(
                run_model_probe_loop(app),
                name="everplain-model-health-probe",
            )
        app.state.model_probe_task = probe_task
        try:
            yield
        finally:
            import_task.cancel()
            with suppress(asyncio.CancelledError):
                await import_task
            if course_task is not None:
                course_task.cancel()
                with suppress(asyncio.CancelledError):
                    await course_task
            if memory_task is not None:
                memory_task.cancel()
                with suppress(asyncio.CancelledError):
                    await memory_task
            if probe_task is not None:
                probe_task.cancel()
                with suppress(asyncio.CancelledError):
                    await probe_task

    def build_catalog_evidence_source(
        *,
        analysis_application: ResearchAnalysisApplication,
    ) -> CatalogTheoryEvidenceSource:
        """Build the release-bound source while tolerating older test doubles.

        The comparison projection is an optional extension of the adapter
        constructor.  Keeping the capability check at this composition point
        lets narrow bootstrap tests replace the adapter with a legacy-shaped
        double without weakening the production wiring.
        """
        kwargs: dict[str, object] = {"retriever": app.state.knowledge_retriever}
        try:
            parameters = signature(CatalogTheoryEvidenceSource).parameters
        except (TypeError, ValueError):
            parameters = {}
        accepts_analysis = "get_confirmed_analysis_evidence" in parameters or any(
            parameter.kind is Parameter.VAR_KEYWORD for parameter in parameters.values()
        )
        if accepts_analysis:
            kwargs["get_confirmed_analysis_evidence"] = (
                analysis_application.confirmed_cycle_evidence
            )
        elif "get_confirmed_comparison_projection" in parameters:
            kwargs["get_confirmed_comparison_projection"] = (
                analysis_application.get_confirmed_comparison_projection
            )
        return CatalogTheoryEvidenceSource(app.state.knowledge_catalog, **kwargs)

    app = FastAPI(
        title=resolved_settings.app_name,
        version="0.1.0",
        description="Everplain personal knowledge and research API.",
        lifespan=lifespan,
    )
    from qunxue_api.api.billing_errors import install_billing_error_handlers

    install_billing_error_handlers(app)
    from qunxue_api.api.writing_errors import install_writing_error_handlers

    install_writing_error_handlers(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved_settings.cors_allowed_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Accept", "Content-Type", "Idempotency-Key"],
    )
    app.state.settings = resolved_settings
    app.state.require_email_verification = require_email_verification
    app.state.email_provider = (
        ResendEmailProvider(
            api_key=resolved_settings.resend_api_key.get_secret_value(),
            from_email=resolved_settings.email_from,
        )
        if resolved_settings.has_resend_api_key
        else None
    )
    app.state.matching_start_lock = Lock()
    app.state.research_start_lock = Lock()
    app.state.database = resolved_database
    app.state.knowledge_catalog = EmptyKnowledgeCatalog(
        resolved_database,
        knowledge_root=KNOWLEDGE_ROOT,
    )
    resolved_knowledge_retriever = knowledge_retriever or _retriever_from_settings(
        resolved_settings
    )
    if resolved_knowledge_retriever is None and resolved_settings.has_model_api_key:
        resolved_knowledge_retriever = CatalogTheoryLexicalRetriever(app.state.knowledge_catalog)
    app.state.knowledge_retriever = resolved_knowledge_retriever
    builtin_case_catalog = BuiltInCaseCatalog.default()
    model_endpoints = (
        _model_endpoints_from_settings(resolved_settings)
        if _effective_model_runtime_mode(resolved_settings) != "mock"
        else ()
    )
    if model_provider is None:
        (
            resolved_model_provider,
            model_router,
            model_attempt_recorder,
        ) = _model_provider_from_settings(
            settings=resolved_settings,
            builtin_case_catalog=builtin_case_catalog,
            database=resolved_database,
            endpoints=model_endpoints,
            probe_transport=model_probe_transport,
        )
    else:
        resolved_model_provider = model_provider
        model_router = None
        model_attempt_recorder = None
    model_invocation_recorder = SqliteModelInvocationRecorder(resolved_database)
    app.state.builtin_case_catalog = builtin_case_catalog
    app.state.model_invocation_recorder = model_invocation_recorder
    app.state.model_endpoints = model_endpoints
    app.state.model_router = model_router
    app.state.model_attempt_recorder = model_attempt_recorder
    from qunxue_api.adapters.research_agent.model_selection import (
        registered_agent_effort_settings,
        registered_agent_models,
        registered_agent_native_authentication,
        selectable_agent_model,
    )
    from qunxue_api.modules.agent_conversation import MOCK_AGENT_MODEL_CHOICES

    selected_choices, selected_endpoint = selectable_agent_model(
        model_endpoints[0] if model_endpoints else None,
        protocol=resolved_settings.agent_model_protocol,
        supported_efforts=resolved_settings.agent_model_supported_efforts,
        default_effort=resolved_settings.model_reasoning_effort,
    )
    additional_choices, additional_routes = registered_agent_models(resolved_settings)
    app.state.agent_model_choices = (
        MOCK_AGENT_MODEL_CHOICES
        if _effective_model_runtime_mode(resolved_settings) == "mock"
        else selected_choices + additional_choices
    )
    selected_agent_router = (
        ModelRouteExecutor(
            endpoints=(selected_endpoint,),
            recorder=model_attempt_recorder,
            max_retries=resolved_settings.model_max_retries,
        )
        if selected_endpoint is not None else None
    )

    from qunxue_api.adapters.model.billing_operations import SqliteBillingOperations

    app.state.billing_operations = SqliteBillingOperations(
        resolved_database,
        _billing_runtime(resolved_settings, resolved_database),
        exempt_user_ids=lambda: getattr(app.state, "credit_exempt_user_ids", ()),
        phase_policies=resolved_settings.billing_phase_policies,
    )
    app.state.model_provider = resolved_model_provider
    app.state.model_gateway = ModelGateway(
        provider=resolved_model_provider,
        recorder=model_invocation_recorder,
        contract_version=resolved_settings.contract_version,
    )
    app.state.research_journey = (
        ResearchJourney(journey_dependencies) if journey_dependencies is not None else None
    )
    password_hasher = Argon2PasswordHasher()
    invalid_password_hash = password_hasher.hash("invalid-account-password")

    def build_identity_service(session) -> IdentityService:
        return IdentityService(
            SqliteIdentityRepository(
                session,
                on_user_created=lambda user: SqliteCreditRepository(session).ensure_welcome_grant(
                    user_id=user.user_id, points=SIGNUP_GRANT, now=user.created_at,
                ),
            ),
            password_hasher,
            invalid_password_hash=invalid_password_hash,
            session_ttl=timedelta(seconds=resolved_settings.session_ttl_seconds),
            email_provider=app.state.email_provider,
            require_email_verification=app.state.require_email_verification,
        )

    @contextmanager
    def identity_service_scope() -> Iterator[IdentityService]:
        with resolved_database.session() as session:
            yield build_identity_service(session)

    app.state.build_identity_service = build_identity_service
    app.state.oauth_clients = OAuthClients(oauth_client_configuration(resolved_settings))
    oauth_transactions = OAuthTransactions(
        resolved_database,
        identity_factory=lambda session: app.state.build_identity_service(session),
    )
    app.state.oauth_application = OAuthLoginApplication(
        clients=lambda: app.state.oauth_clients,
        transactions=oauth_transactions,
        identities=oauth_transactions.identities,
        atomic_identities=oauth_transactions.atomic_identities,
    )

    @contextmanager
    def research_task_service_scope() -> Iterator[ResearchTaskService]:
        with resolved_database.session() as session:
            yield ResearchTaskService(SqliteResearchTaskRepository(session))

    @contextmanager
    def phenomenon_service_scope() -> Iterator[PhenomenonService]:
        with resolved_database.session() as session:
            yield PhenomenonService(
                SqlitePhenomenonRepository(session),
                SqliteResearchTaskRepository(session),
            )

    @contextmanager
    def phenomenon_extraction_scope(*, user_id, run_id, payload):
        # Financial scope outlives the business transaction, including its final commit.
        with ExitStack() as stack:
            scope = None
            with resolved_database.session() as session:
                if not app.state.model_gateway.descriptor.demonstration:
                    scope = stack.enter_context(app.state.billing_operations.open(
                        user_id=user_id, run_id=run_id, payload=payload,
                        before_network=session.commit, phase="user_research",
                    ))
                yield PhenomenonService(
                    SqlitePhenomenonRepository(session), SqliteResearchTaskRepository(session),
                )
                if scope is not None:
                    session.flush()
                    scope.finish("success", connection=session.connection())

    def build_research_analysis_application(
        session,
        *,
        task_repository: SqliteResearchTaskRepository | None = None,
    ) -> ResearchAnalysisApplication:
        return ResearchAnalysisApplication(
            analysis=ResearchAnalysisService(SqliteResearchAnalysisRepository(session)),
            materials=SqliteResearchMaterialRepository(session),
            research_tasks=task_repository or SqliteResearchTaskRepository(session),
            commit=session.commit,
        )

    @contextmanager
    def theory_matching_application_scope() -> Iterator[TheoryMatchingApplication]:
        # Hold the process lock until the transaction commits. Cross-process
        # writers are rejected by the task repository's version CAS.
        with app.state.matching_start_lock, resolved_database.session() as session:
            descriptor = app.state.model_gateway.descriptor
            analysis_application = build_research_analysis_application(session)
            method_plan_service = MethodPlanService(SqliteMethodPlanRepository(session))
            matching = TheoryMatchingService(
                evidence_source=build_catalog_evidence_source(
                    analysis_application=analysis_application,
                ),
                judge=app.state.model_gateway,
                repository=SqliteMatchRunRepository(session),
                provider=descriptor.provider,
                model_version=descriptor.model_version,
                capability=descriptor.capability_tier,
                contract_version=resolved_settings.contract_version,
            )
            yield TheoryMatchingApplication(
                catalog=app.state.knowledge_catalog,
                matching=matching,
                matching_requests=SqliteMatchingRequestRepository(session),
                research_tasks=SqliteResearchTaskRepository(session),
                rollback=session.rollback,
                billing=app.state.billing_operations.bound_to(session)
                if not descriptor.demonstration else None,
                commit=session.commit,
                invalidate_method_plan=(
                    lambda task_id, reason: method_plan_service.mark_stale_for_task(
                        task_id=task_id, reason=reason
                    )
                ),
            )

    app.state.research_task_service_scope = research_task_service_scope
    app.state.phenomenon_service_scope = phenomenon_service_scope
    app.state.phenomenon_extraction_scope = phenomenon_extraction_scope
    app.state.theory_matching_application_scope = theory_matching_application_scope

    @contextmanager
    def research_material_application_scope() -> Iterator[ResearchMaterialApplication]:
        with resolved_database.session() as session:
            yield ResearchMaterialApplication(
                materials=SqliteResearchMaterialRepository(session),
                research_tasks=SqliteResearchTaskRepository(session),
                parser=parse_material,
                search=SqliteResearchMaterialSearchRepository(session),
                transcription_available=resolved_settings.has_transcription_provider,
                index_material=app.state.research_material_indexer,
                schedule_ingestion=(
                    lambda job_id: app.state.schedule_research_material_ingestion(job_id)
                ),
                commit=session.commit,
                rollback=session.rollback,
            )

    app.state.research_material_application_scope = research_material_application_scope

    ingestion_executor = ThreadPoolExecutor(
        max_workers=2,
        thread_name_prefix="qunxue-material-ingestion",
    )

    def process_research_material_ingestion(job_id: UUID) -> None:
        while True:
            try:
                with research_material_application_scope() as application:
                    job = application.process_ingestion(job_id)
            except MaterialParseError:
                logger.info(
                    "research material ingestion needs user action",
                    extra={"job_id": str(job_id)},
                )
                return
            except Exception:
                logger.exception(
                    "research material ingestion attempt failed",
                    extra={"job_id": str(job_id)},
                )
                with research_material_application_scope() as application:
                    job = application.get_ingestion_job(job_id)
            if (
                job is None
                or job.ingestion_status is not MaterialIngestionStatus.FAILED
                or job.completed_at is not None
                or job.attempt_count >= job.max_attempts
            ):
                return
            delay = max(0.0, (job.available_at - datetime.now(UTC)).total_seconds())
            if delay:
                sleep(delay)

    def schedule_research_material_ingestion(job_id: UUID) -> None:
        ingestion_executor.submit(process_research_material_ingestion, job_id)

    def recover_research_material_ingestions() -> None:
        with research_material_application_scope() as application:
            recoverable = application.recoverable_ingestion_ids()
        for job_id in recoverable:
            schedule_research_material_ingestion(job_id)

    def shutdown_research_material_ingestions() -> None:
        ingestion_executor.shutdown(wait=True, cancel_futures=False)

    app.state.schedule_research_material_ingestion = schedule_research_material_ingestion
    app.router.add_event_handler("startup", recover_research_material_ingestions)
    app.router.add_event_handler("shutdown", shutdown_research_material_ingestions)

    @contextmanager
    def professional_materials_application_scope() -> Iterator[ProfessionalMaterialsApplication]:
        with resolved_database.session() as session:
            yield ProfessionalMaterialsApplication(
                archive=SqliteProfessionalMaterialRepository(session),
                materials=SqliteResearchMaterialRepository(session),
                research_tasks=SqliteResearchTaskRepository(session),
                commit=session.commit,
                doi_resolver=CrossrefDoiMetadataResolver(),
            )

    app.state.professional_materials_application_scope = professional_materials_application_scope

    @contextmanager
    def shared_knowledge_scope():
        with resolved_database.session() as session:
            yield SharedKnowledgeApplication(
                SqliteSharedKnowledgeRepository(session),
                parser=parse_material,
                max_file_bytes=resolved_settings.max_file_bytes,
                max_storage_bytes=resolved_settings.max_storage_bytes,
                max_libraries=resolved_settings.max_libraries,
                max_documents_per_library=resolved_settings.max_documents_per_library,
            )

    app.state.shared_knowledge_scope = shared_knowledge_scope

    @contextmanager
    def knowledge_import_scope():
        with resolved_database.session() as session:
            libraries = SharedKnowledgeApplication(
                SqliteSharedKnowledgeRepository(session),
                parser=parse_material,
                max_file_bytes=resolved_settings.max_file_bytes,
                max_storage_bytes=resolved_settings.max_storage_bytes,
                max_libraries=resolved_settings.max_libraries,
                max_documents_per_library=resolved_settings.max_documents_per_library,
            )
            yield KnowledgeImportApplication(
                SqliteImportRepository(session),
                libraries,
                parse_files,
                app.state.import_fetch_text,
                app.state.media_import_gateway,
            )

    def run_import_once():
        with knowledge_import_scope() as application:
            worked = application.run_once()
            if worked and application.last_user_id:
                with personal_graph_scope() as graph:
                    graph.repository.mark_dirty(application.last_user_id)
            return worked

    @contextmanager
    def personal_graph_scope():
        with resolved_database.session() as session:
            namer = (
                GraphTopicNamer(app.state.model_router, billing=app.state.billing_operations)
                if app.state.model_endpoints
                and resolved_settings.runtime_mode != "mock"
                and app.state.billing_operations.runtime is not None
                and resolved_settings.billing_phase_policies.get("graph_topic_naming") == "operator"
                else None
            )
            yield PersonalGraphApplication(
                SqlitePersonalGraphRepository(
                    session,
                    mock=resolved_settings.runtime_mode == "mock",
                    embedding_model=resolved_settings.embedding_model,
                ),
                name_topic=namer,
            )

    def run_graph_once():
        with personal_graph_scope() as graph:
            user_id = graph.repository.next_pending()
            if user_id:
                graph.refresh(user_id)

    app.state.personal_graph_scope = personal_graph_scope
    app.state.run_graph_once = run_graph_once
    vision = None
    if (
        resolved_settings.runtime_mode != "mock"
        and resolved_settings.vision_base_url
        and resolved_settings.vision_model
    ):
        vision = OpenAICompatibleVisionProvider(
            base_url=resolved_settings.vision_base_url,
            model=resolved_settings.vision_model,
            api_key=(
                resolved_settings.vision_api_key.get_secret_value()
                if resolved_settings.vision_api_key
                else None
            ),
        )
    app.state.media_import_gateway = MediaImportGateway(
        BilibiliFavoritesAdapter(),
        ImageImportAdapter(provider=vision),
    )
    app.state.knowledge_import_scope = knowledge_import_scope
    app.state.import_fetch_text = fetch_bookmark
    app.state.run_import_once = run_import_once
    app.state.import_worker_enabled = True

    @contextmanager
    def research_analysis_application_scope() -> Iterator[ResearchAnalysisApplication]:
        with resolved_database.session() as session:
            yield build_research_analysis_application(session)

    app.state.research_analysis_application_scope = research_analysis_application_scope

    @contextmanager
    def research_project_exchange_application_scope() -> Iterator[
        ResearchProjectExchangeApplication
    ]:
        with resolved_database.session() as session:
            yield ResearchProjectExchangeApplication(
                research_tasks=SqliteResearchTaskRepository(session),
                materials=SqliteResearchMaterialRepository(session),
                professional_archive=SqliteProfessionalMaterialRepository(session),
                analysis=SqliteResearchAnalysisRepository(session),
                documents=SqliteResearchDocumentRepository(session),
                cycles=SqliteResearchCycleRepository(session),
                audit=SqliteResearchProjectAuditRepository(session),
                project_mapper=map_published_qunxue_project,
                commit=session.commit,
            )

    app.state.research_project_exchange_application_scope = (
        research_project_exchange_application_scope
    )

    @contextmanager
    def research_method_plan_application_scope() -> Iterator[ResearchMethodPlanApplication]:
        with resolved_database.session() as session:
            documents = SqliteResearchDocumentRepository(session)
            matches = SqliteMatchRunRepository(session)
            task_repository = SqliteResearchTaskRepository(session)
            material_repository = SqliteResearchMaterialRepository(session)
            analysis_application = build_research_analysis_application(
                session,
                task_repository=task_repository,
            )
            professional_application = ProfessionalMaterialsApplication(
                archive=SqliteProfessionalMaterialRepository(session),
                materials=material_repository,
                research_tasks=task_repository,
            )
            cycle_application = ResearchCycleApplication(
                analysis=analysis_application,
                materials=material_repository,
                professional_materials=professional_application,
                get_theory_plan_for_task=matches.get_confirmed_plan_for_task,
                snapshots=SqliteResearchCycleRepository(session),
            )
            yield ResearchMethodPlanApplication(
                plans=MethodPlanService(SqliteMethodPlanRepository(session)),
                research_tasks=task_repository,
                mutations=SqliteResearchDocumentMutationRepository(session),
                get_framework=documents.latest,
                get_theory_plan=matches.get_confirmed_plan,
                get_cycle_snapshot=lambda user_id, task_id: cycle_application.current(
                    user_id=user_id,
                    task_id=task_id,
                ),
            )

    app.state.research_method_plan_application_scope = research_method_plan_application_scope

    @contextmanager
    def research_cycle_application_scope() -> Iterator[ResearchCycleApplication]:
        with resolved_database.session() as session:
            task_repository = SqliteResearchTaskRepository(session)
            material_repository = SqliteResearchMaterialRepository(session)
            yield ResearchCycleApplication(
                analysis=build_research_analysis_application(
                    session,
                    task_repository=task_repository,
                ),
                materials=material_repository,
                professional_materials=ProfessionalMaterialsApplication(
                    archive=SqliteProfessionalMaterialRepository(session),
                    materials=material_repository,
                    research_tasks=task_repository,
                ),
                get_theory_plan_for_task=SqliteMatchRunRepository(
                    session
                ).get_confirmed_plan_for_task,
                snapshots=SqliteResearchCycleRepository(session),
            )

    app.state.research_cycle_application_scope = research_cycle_application_scope

    @contextmanager
    def research_navigation_match_reader_scope() -> Iterator[SqliteMatchRunRepository]:
        with resolved_database.session() as session:
            yield SqliteMatchRunRepository(session)

    app.state.research_navigation_match_reader_scope = research_navigation_match_reader_scope

    @contextmanager
    def research_start_application_scope() -> Iterator[ResearchStartApplication]:
        # Keep the in-process read/create/link sequence contiguous; database
        # uniqueness remains the cross-process duplicate-task backstop.
        with app.state.research_start_lock, resolved_database.session() as session:
            task_repository = SqliteResearchTaskRepository(session)
            yield ResearchStartApplication(
                proposals=SqliteResearchStartProposalRepository(session),
                bindings=SqliteConversationRepository(session),
                tasks=ResearchTaskService(task_repository),
                phenomena=PhenomenonService(SqlitePhenomenonRepository(session), task_repository),
            )

    app.state.research_start_application_scope = research_start_application_scope

    def personal_document_evidence_validator(session):
        def validate(*, user_id, evidence):
            from qunxue_api.modules.research_framework import ResearchDocumentEvidenceSourceKind

            if evidence.source_kind is ResearchDocumentEvidenceSourceKind.WEB:
                from urllib.parse import urlparse

                url = urlparse(evidence.source_id)
                if url.scheme not in {"https", "http"} or not url.hostname:
                    raise ValueError("网页引用地址无效。")
                return {"title": evidence.source_id, "url": evidence.source_id}
            if evidence.source_kind is ResearchDocumentEvidenceSourceKind.PERSONAL_KNOWLEDGE:
                owned = SqliteSharedKnowledgeRepository(session).owned_document(
                    user_id, evidence.material_id
                )
                if owned is None:
                    raise ValueError("引用的知识库资料已删除或不可访问。")
                _, document = owned
                segment = next(
                    (
                        item
                        for item in document.segments
                        if item["segment_id"] == evidence.segment_id
                    ),
                    None,
                )
                if (
                    segment is None
                    or document.parse_id != evidence.parse_id
                    or segment["locator"] != evidence.locator
                    or evidence.source_id != f"material:{document.id}:{evidence.segment_id}"
                ):
                    raise ValueError("知识库引用与原文位置不一致。")
                return {"title": document.filename, "locator": segment["locator"]}
            if evidence.source_kind is ResearchDocumentEvidenceSourceKind.RESEARCH_MATERIAL:
                repository = SqliteResearchMaterialRepository(session)
                material = repository.get_owned(evidence.material_id, user_id=user_id)
                if material is None:
                    raise ValueError("引用的项目附件已删除或不可访问。")
                segment = repository.get_segment(
                    evidence.material_id,
                    evidence.parse_id,
                    evidence.segment_id,
                    user_id=user_id,
                    task_id=material.task_id,
                )
                if segment is None or segment.locator != evidence.locator:
                    raise ValueError("项目附件引用与原文位置不一致。")
                return {
                    "title": material.display_name or material.original_filename,
                    "locator": segment.locator,
                }
            raise ValueError("个人文稿不能引用学科公共库。")

        return validate

    @contextmanager
    def research_document_application_scope() -> Iterator[ResearchDocumentApplication]:
        with resolved_database.session() as session:
            match_runs = SqliteMatchRunRepository(session)
            method_plans = SqliteMethodPlanRepository(session)
            method_plan_service = MethodPlanService(method_plans)
            matching_requests = SqliteMatchingRequestRepository(session)
            proposals = SqliteResearchDocumentProposalRepository(session)
            analysis_application = build_research_analysis_application(session)
            yield ResearchDocumentApplication(
                validate_personal_evidence=personal_document_evidence_validator(session),
                documents=ResearchDocumentService(
                    repository=SqliteResearchDocumentRepository(session)
                ),
                research_tasks=SqliteResearchTaskRepository(session),
                mutations=SqliteResearchDocumentMutationRepository(session),
                get_theory_plan=match_runs.get_confirmed_plan,
                get_match_run=match_runs.get,
                list_proposals_for_task=proposals.list_for_task,
                list_actionable_proposals_for_task=proposals.list_actionable_for_task,
                owns_match_run=matching_requests.owns,
                formal_analysis_handoff=analysis_application.formal_handoff,
                get_method_plan=method_plans.latest_for_task,
                invalidate_method_plan=(
                    lambda task_id, reason: method_plan_service.mark_stale_for_task(
                        task_id=task_id, reason=reason
                    )
                ),
            )

    app.state.research_document_application_scope = research_document_application_scope

    @contextmanager
    def research_document_proposal_application_scope() -> Iterator[
        ResearchDocumentProposalApplication
    ]:
        with resolved_database.session() as session:
            documents = ResearchDocumentService(
                repository=SqliteResearchDocumentRepository(session)
            )
            match_runs = SqliteMatchRunRepository(session)
            method_plans = SqliteMethodPlanRepository(session)
            method_plan_service = MethodPlanService(method_plans)
            matching_requests = SqliteMatchingRequestRepository(session)
            proposal_repository = SqliteResearchDocumentProposalRepository(session)
            analysis_application = build_research_analysis_application(session)
            document_application = ResearchDocumentApplication(
                validate_personal_evidence=personal_document_evidence_validator(session),
                documents=documents,
                research_tasks=SqliteResearchTaskRepository(session),
                mutations=SqliteResearchDocumentMutationRepository(session),
                get_theory_plan=match_runs.get_confirmed_plan,
                get_match_run=match_runs.get,
                list_proposals_for_task=proposal_repository.list_for_task,
                list_actionable_proposals_for_task=(proposal_repository.list_actionable_for_task),
                owns_match_run=matching_requests.owns,
                formal_analysis_handoff=analysis_application.formal_handoff,
                get_method_plan=method_plans.latest_for_task,
                invalidate_method_plan=(
                    lambda task_id, reason: method_plan_service.mark_stale_for_task(
                        task_id=task_id, reason=reason
                    )
                ),
            )
            yield ResearchDocumentProposalApplication(
                ResearchDocumentProposalService(
                    repository=proposal_repository,
                    documents=documents,
                    atomic=session.begin_nested,
                    validate_proposal=document_application.validate_proposal,
                ),
                research_tasks=SqliteResearchTaskRepository(session),
                mutations=SqliteResearchDocumentMutationRepository(session),
                invalidate_method_plan=(
                    lambda task_id, reason: method_plan_service.mark_stale_for_task(
                        task_id=task_id, reason=reason
                    )
                ),
            )

    app.state.research_document_proposal_application_scope = (
        research_document_proposal_application_scope
    )

    @contextmanager
    def disciplinary_agent_scope() -> Iterator[DisciplinaryAgentApplication]:
        with resolved_database.session() as session:
            conversation_repository = SqliteConversationRepository(session)
            conversations = ConversationService(conversation_repository)
            task_repository = SqliteResearchTaskRepository(session)
            task_service = ResearchTaskService(task_repository)
            phenomenon_service = PhenomenonService(
                SqlitePhenomenonRepository(session), task_repository
            )
            document_service = ResearchDocumentService(
                repository=SqliteResearchDocumentRepository(session)
            )
            match_runs = SqliteMatchRunRepository(session)
            method_plans = SqliteMethodPlanRepository(session)
            method_plan_service = MethodPlanService(method_plans)
            matching_requests = SqliteMatchingRequestRepository(session)
            proposal_repository = SqliteResearchDocumentProposalRepository(session)
            material_repository = SqliteResearchMaterialRepository(session)
            analysis_application = build_research_analysis_application(
                session,
                task_repository=task_repository,
            )
            descriptor = app.state.model_gateway.descriptor
            matching_service = TheoryMatchingService(
                evidence_source=build_catalog_evidence_source(
                    analysis_application=analysis_application,
                ),
                judge=app.state.model_gateway,
                repository=match_runs,
                provider=descriptor.provider,
                model_version=descriptor.model_version,
                capability=descriptor.capability_tier,
                contract_version=resolved_settings.contract_version,
            )
            matching_application = TheoryMatchingApplication(
                catalog=app.state.knowledge_catalog,
                matching=matching_service,
                matching_requests=matching_requests,
                research_tasks=task_repository,
                rollback=session.rollback,
                invalidate_method_plan=(
                    lambda task_id, reason: method_plan_service.mark_stale_for_task(
                        task_id=task_id, reason=reason
                    )
                ),
            )
            research_start_application = ResearchStartApplication(
                proposals=SqliteResearchStartProposalRepository(session),
                bindings=conversation_repository,
                tasks=task_service,
                phenomena=phenomenon_service,
            )
            agent_research_workflow = AgentResearchWorkflow(
                bindings=conversation_repository,
                tasks=task_service,
                task_repository=task_repository,
                phenomena=phenomenon_service,
                matching=matching_application,
                research_start=research_start_application,
            )
            document_application = ResearchDocumentApplication(
                validate_personal_evidence=personal_document_evidence_validator(session),
                documents=document_service,
                research_tasks=task_repository,
                mutations=SqliteResearchDocumentMutationRepository(session),
                get_theory_plan=match_runs.get_confirmed_plan,
                get_match_run=match_runs.get,
                list_proposals_for_task=proposal_repository.list_for_task,
                list_actionable_proposals_for_task=(proposal_repository.list_actionable_for_task),
                owns_match_run=matching_requests.owns,
                formal_analysis_handoff=analysis_application.formal_handoff,
                get_method_plan=method_plans.latest_for_task,
                invalidate_method_plan=(
                    lambda task_id, reason: method_plan_service.mark_stale_for_task(
                        task_id=task_id, reason=reason
                    )
                ),
            )
            proposal_service = ResearchDocumentProposalService(
                repository=proposal_repository,
                documents=document_service,
                atomic=session.begin_nested,
                validate_proposal=document_application.validate_proposal,
            )
            # A key in the local .env opts the independent Agent into a real
            # OpenAI-compatible runtime while keeping the deterministic runner
            # as the zero-config development default.
            agent_runtime_mode = _effective_model_runtime_mode(resolved_settings)
            use_real_agent = agent_runtime_mode != "mock"
            if resolved_settings.allow_model_fallback and not resolved_settings.has_model_api_key:
                use_real_agent = False
                runner = PydanticAIKnowledgeRunner(
                    base_url="http://model-unconfigured.invalid",
                    api_key=None,
                    model="unconfigured-model-fallback",
                    timeout_seconds=resolved_settings.model_timeout_seconds,
                    model_api_mock=True,
                )
            elif not use_real_agent:
                runner = DeterministicKnowledgeRunner()
            else:
                agent_endpoints = app.state.model_endpoints
                if not agent_endpoints:
                    raise ValueError(
                        "EVERPLAIN_MODEL_BASE_URL and EVERPLAIN_MODEL_NAME "
                        "are required for Agent runtime"
                    )
                primary_endpoint = agent_endpoints[0]
                runner = PydanticAIKnowledgeRunner(
                    base_url=primary_endpoint.base_url,
                    api_key=primary_endpoint.api_key,
                    model=primary_endpoint.model,
                    fallback_endpoints=tuple(
                        (endpoint.base_url, endpoint.api_key, endpoint.model)
                        for endpoint in agent_endpoints[1:]
                    ),
                    timeout_seconds=resolved_settings.model_timeout_seconds,
                    extra_headers=primary_endpoint.extra_headers,
                    reasoning_effort=resolved_settings.model_reasoning_effort,
                    route_executor=app.state.model_router,
                    model_capacities=resolved_settings.agent_model_capacities,
                    require_billing=True,
                )
            def runner_for_selection(selection):
                if not use_real_agent:
                    return runner
                route_endpoint, route_protocol = additional_routes.get(
                    selection.model_id, (selected_endpoint, "responses"),
                )
                route_executor = (
                    ModelRouteExecutor(
                        endpoints=(route_endpoint,), recorder=model_attempt_recorder,
                        max_retries=resolved_settings.model_max_retries,
                    ) if selection.model_id in additional_routes else selected_agent_router
                )
                if route_endpoint is None or route_executor is None:
                    from qunxue_api.modules.agent_conversation import (
                        AgentModelSelectionUnavailable,
                    )
                    raise AgentModelSelectionUnavailable("当前服务尚未接通所选模型路由。")
                return PydanticAIKnowledgeRunner(
                    base_url=route_endpoint.base_url,
                    api_key=route_endpoint.api_key,
                    model=route_endpoint.model,
                    timeout_seconds=route_endpoint.timeout_seconds,
                    extra_headers=route_endpoint.extra_headers,
                    reasoning_effort=selection.reasoning_effort,
                    reasoning_settings=registered_agent_effort_settings(
                        resolved_settings, selection,
                    ),
                    native_cache_omission_is_zero=(
                        resolved_settings.billing_usage_policies.get(
                            f"{httpx.URL(route_endpoint.base_url).host}:{route_endpoint.model}"
                        ) == "omitted_cache_subsets_are_zero"
                    ),
                    protocol=route_protocol,
                    native_authentication=registered_agent_native_authentication(
                        resolved_settings, selection,
                    ),
                    route_executor=route_executor,
                    model_capacities=resolved_settings.agent_model_capacities,
                    require_billing=True,
                )

            try:
                yield DisciplinaryAgentApplication(
                    shared_references=SharedKnowledgeReferences(
                        SharedKnowledgeApplication(
                            SqliteSharedKnowledgeRepository(session),
                            parser=parse_material,
                            max_file_bytes=resolved_settings.max_file_bytes,
                            max_storage_bytes=resolved_settings.max_storage_bytes,
                            max_libraries=resolved_settings.max_libraries,
                            max_documents_per_library=resolved_settings.max_documents_per_library,
                        ),
                        app.state.knowledge_retriever,
                    ),
                    persona_factory=current_persona,
                    memory_tools_factory=lambda **scope: AgentMemoryTools(
                        memory_service_scope, conversation_scope=conversation_context_scope, **scope
                    ),
                    conversations=conversations,
                    runner=runner,
                    model_choices=app.state.agent_model_choices,
                    runner_for_selection=runner_for_selection,
                    billing=(
                        app.state.billing_operations.bound_to(session) if use_real_agent else None
                    ),
                    rollback=session.rollback,
                    credits=CreditService(
                        SqliteCreditRepository(
                            session, plan_limits=resolved_settings.billing_plan_weekly_points
                        ),
                        exempt_user_ids=getattr(
                            app.state,
                            "credit_exempt_user_ids",
                            (),
                        ),
                    ),
                    atomic=(
                        app.state.billing_operations.bound_to(session).atomic
                        if use_real_agent else session.begin_nested
                    ),
                    ensure_research_draft=(
                        lambda **payload: (
                            research_start_application.ensure_draft_project(**payload).task_id
                        )
                    ),
                    bind_research_draft=(
                        lambda **payload: (
                            research_start_application.bind_material_first_draft(**payload).task_id
                        )
                    ),
                    tools_factory=lambda: ResearchDocumentToolRegistry(
                        catalog=app.state.knowledge_catalog,
                        retriever=app.state.knowledge_retriever,
                        web_research=OpenWebResearchClient(
                            require_search_billing=True,
                            search_provider=resolved_settings.web_search_provider,
                            search_api_key=(
                                resolved_settings.web_search_api_key.get_secret_value()
                                if resolved_settings.web_search_api_key
                                else None
                            ),
                            search_base_url=resolved_settings.web_search_base_url,
                            profile=resolved_settings.web_search_profile,
                            allowed_domains=resolved_settings.web_search_allowed_domains,
                            search_timeout_seconds=(resolved_settings.web_search_timeout_seconds),
                            reranker=app.state.knowledge_retriever,
                        ),
                        documents=document_application,
                        proposals=proposal_service,
                        workflow=agent_research_workflow,
                        materials=material_repository,
                        material_search=SqliteResearchMaterialSearchRepository(session),
                        material_vector_cache_factory=lambda **scope: SqliteMaterialVectorCache(
                            session, **scope
                        ),
                        require_material_vectors=resolved_settings.runtime_mode != "mock",
                        analysis=analysis_application,
                        writing=WritingApplication(SqliteWritingRepository(session)),
                    ),
                )
            except Exception:
                # A failed model turn is an auditable run that must survive the
                # request rollback so the same idempotency key can retry safely.
                session.commit()
                raise

    app.state.disciplinary_agent_scope = disciplinary_agent_scope

    @contextmanager
    def memory_service_scope():
        with resolved_database.session() as memory_session:
            yield MemoryService(SqliteMemoryRepository(memory_session))

    app.state.memory_service_scope = memory_service_scope

    @contextmanager
    def conversation_context_scope():
        from qunxue_api.adapters.sqlite.conversation_context_repository import (
            SqliteConversationContextRepository,
        )
        with resolved_database.session() as session:
            yield (
                SqliteConversationContextRepository(
                    session, summary_enabled=resolved_settings.conversation_summary_enabled
                ),
                SqliteMemoryRepository(session),
            )

    app.state.conversation_context_scope = conversation_context_scope


    @contextmanager
    def agent_profile_scope():
        with resolved_database.session() as session:
            yield AgentProfileApplication(
                SqliteAgentProfileRepository(session),
                MemoryService(SqliteMemoryRepository(session)),
            )

    app.state.agent_profile_scope = agent_profile_scope

    app.state.writing_generate = None
    if app.state.model_endpoints and _effective_model_runtime_mode(resolved_settings) != "mock":
        def generate_writing(document, request, samples, run_id):
            # Match ordinary Agent request scoping: an async SDK client must not
            # be shared by concurrent FastAPI worker threads/event loops.
            writing_endpoint = selected_endpoint or app.state.model_endpoints[0]
            writing_runner = PydanticAIKnowledgeRunner(
                base_url=writing_endpoint.base_url,
                api_key=writing_endpoint.api_key,
                model=writing_endpoint.model,
                fallback_endpoints=() if selected_endpoint else tuple(
                    (e.base_url, e.api_key, e.model) for e in app.state.model_endpoints[1:]
                ),
                timeout_seconds=resolved_settings.model_timeout_seconds,
                extra_headers=writing_endpoint.extra_headers,
                reasoning_effort=(
                    selected_choices[0].default_reasoning_effort if selected_endpoint
                    else resolved_settings.model_reasoning_effort
                ),
                route_executor=selected_agent_router or app.state.model_router,
                protocol="responses" if selected_endpoint else "chat_completions",
                require_billing=True,
            )
            try:
                return WritingPipeline(writing_runner.run_writing_stage).generate(
                    document, request, samples, run_id
                )
            except AgentModelRouteError as exc:
                raise WritingUnavailable("模型暂时不可用，原文没有改变，请稍后重试") from exc

        app.state.writing_generate = generate_writing

    @contextmanager
    def writing_scope():
        try:
            with resolved_database.session() as session:
                yield WritingApplication(
                    SqliteWritingRepository(session),
                    generate=app.state.writing_generate,
                    sample_parser=parse_material,
                    billing=app.state.billing_operations.bound_to(session)
                    if app.state.model_endpoints else None,
                )
        except IntegrityError as exc:
            raise WritingConflict("请求与另一操作冲突，请刷新后重试") from exc

    app.state.writing_scope = writing_scope

    def current_persona(user_id):
        with agent_profile_scope() as application:
            return application.get(user_id).persona()

    app.state.memory_overview = MemoryOverview(
        billing=app.state.billing_operations if app.state.model_endpoints else None
    )
    if app.state.model_endpoints:
        endpoint = app.state.model_endpoints[0]
        app.state.memory_overview.generate = PydanticMemoryOverview(
            base_url=endpoint.base_url,
            api_key=endpoint.api_key,
            model=endpoint.model,
            extra_headers=endpoint.extra_headers,
            timeout_seconds=min(resolved_settings.model_timeout_seconds, 45),
        )

    @contextmanager
    def memory_learning_scope():
        with resolved_database.session() as memory_session:
            yield SqliteMemoryLearningRepository(memory_session)

    memory_extractor = None
    if app.state.model_endpoints and resolved_settings.memory_learning_enabled:
        memory_endpoint = app.state.model_endpoints[0]
        memory_extractor = PydanticMemoryExtractor(
            base_url=memory_endpoint.base_url,
            api_key=memory_endpoint.api_key,
            model=memory_endpoint.model,
            extra_headers=memory_endpoint.extra_headers,
            timeout_seconds=min(resolved_settings.model_timeout_seconds, 45),
        )
    app.state.memory_worker = MemoryLearningWorker(
        memory_learning_scope,
        extractor=memory_extractor,
        billing=app.state.billing_operations if memory_extractor else None,
        idle_seconds=resolved_settings.memory_learning_idle_seconds,
        daily_calls=resolved_settings.memory_learning_daily_calls,
        daily_tokens=resolved_settings.memory_learning_daily_tokens,
    )
    @contextmanager
    def context_summary_scope():
        with resolved_database.session() as summary_session:
            yield SqliteConversationSummaryRepository(
                summary_session, enabled=resolved_settings.conversation_summary_enabled
            )

    app.state.context_summary_scope = context_summary_scope
    context_summarizer = None
    if app.state.model_endpoints and resolved_settings.conversation_summary_enabled:
        summary_endpoint = app.state.model_endpoints[0]
        context_summarizer = PydanticConversationSummarizer(
            base_url=summary_endpoint.base_url, api_key=summary_endpoint.api_key,
            model=summary_endpoint.model, extra_headers=summary_endpoint.extra_headers,
            timeout_seconds=min(resolved_settings.model_timeout_seconds, 45),
        )
    app.state.context_summary_worker = ConversationSummaryWorker(
        context_summary_scope, generate=context_summarizer,
        billing=app.state.billing_operations if context_summarizer else None,
        idle_seconds=resolved_settings.conversation_summary_idle_seconds,
        daily_calls=resolved_settings.memory_learning_daily_calls,
        daily_tokens=resolved_settings.memory_learning_daily_tokens,
    )
    course_embedder = None
    if resolved_settings.embedding_model and resolved_settings.embedding_api_key:
        course_embedder = OpenAICompatibleEmbeddingProvider(
            base_url=resolved_settings.embedding_base_url,
            api_key=resolved_settings.embedding_api_key.get_secret_value(),
            model=resolved_settings.embedding_model,
            timeout_seconds=resolved_settings.embedding_timeout_seconds,
        )
    app.state.research_material_indexer = (
        ResearchMaterialIndexer(
            resolved_database, embedder=course_embedder,
            embedding_model=resolved_settings.embedding_model,
        )
        if resolved_settings.runtime_mode != "mock" else None
    )
    app.state.course_organization_worker = CourseOrganizationWorker(
        resolved_database,
        generate=CourseKnowledgeGenerator(
            (selected_endpoint,) if selected_endpoint else app.state.model_endpoints,
            route_executor=selected_agent_router or app.state.model_router,
            protocol="responses" if selected_endpoint else "chat_completions",
            reasoning_effort=(
                selected_choices[0].default_reasoning_effort if selected_endpoint else None
            ),
            cost_limits=CourseCostLimits(
                input_tokens=resolved_settings.organization_max_input_tokens,
                output_tokens=resolved_settings.organization_max_output_tokens,
                batch_chars=resolved_settings.organization_batch_chars,
                max_batches=resolved_settings.organization_max_batches,
                concurrency=resolved_settings.organization_max_concurrency,
                retries=resolved_settings.organization_max_retries,
                budget=resolved_settings.organization_budget,
                input_rate=resolved_settings.organization_input_rate_per_million,
                output_rate=resolved_settings.organization_output_rate_per_million,
                currency=resolved_settings.organization_cost_currency,
            ).with_billing_defaults(
                app.state.billing_operations.runtime,
                (selected_endpoint,) if selected_endpoint else app.state.model_endpoints,
            ),
        )
        if app.state.model_endpoints
        else None,
        embedder=course_embedder,
        embedding_model=resolved_settings.embedding_model,
        billing=app.state.billing_operations,
    )
    app.include_router(shared_knowledge_router)
    app.include_router(memories_router)
    app.state.identity_service_scope = identity_service_scope
    app.include_router(health_router)
    app.include_router(session_router)
    app.include_router(oauth_session_router)
    app.include_router(research_tasks_router)
    app.include_router(research_documents_router)
    app.include_router(research_materials_router)
    app.include_router(professional_materials_router)
    app.include_router(research_method_router)
    app.include_router(research_analysis_router)
    app.include_router(research_cycle_router)
    app.include_router(research_exchange_router)
    app.include_router(phenomena_router)
    app.include_router(material_intakes_router)

    @contextmanager
    def external_agents_scope():
        with resolved_database.session() as session:
            yield ExternalAgentApplication(
                ExternalAgentService(SqliteExternalAgentRepository(session)),
                identities=SqliteIdentityRepository(session),
                libraries=SharedKnowledgeService(SqliteSharedKnowledgeRepository(session)),
            )

    @contextmanager
    def subscription_repository_scope():
        with resolved_database.session() as session:
            yield SqliteSubscriptionRepository(session)

    commerce_settings = CommerceSettings(_env_file=None)
    if resolved_settings.runtime_mode == "mock":
        commerce_settings.stripe_enabled = False
    app.state.model_catalog = build_model_catalog(resolved_settings, commerce_settings)
    app.state.subscription_application = SubscriptionApplication(
        subscription_repository_scope,
        StripeSubscriptionGateway(commerce_settings),
        plans=commerce_settings.plans(),
        plan_limits=resolved_settings.billing_plan_weekly_points,
        unavailable_reason=commerce_settings.unavailable_reason,
        success_url=commerce_settings.stripe_success_url,
        cancel_url=commerce_settings.stripe_cancel_url,
        portal_return_url=commerce_settings.stripe_portal_return_url,
    )
    @contextmanager
    def channel_gateway_scope():
        with resolved_database.session() as session:
            yield ChannelGatewayApplication(
                SqliteChannelGatewayRepository(session), SqliteIdentityRepository(session)
            )

    app.state.channel_gateway_scope = channel_gateway_scope
    app.include_router(channel_gateway_router)
    app.state.external_agents_scope = external_agents_scope
    app.include_router(external_agents_router)
    app.include_router(commerce_router)
    app.include_router(personal_graph_router)
    app.include_router(knowledge_import_router)
    app.include_router(agent_profile_router)
    app.include_router(writing_router)
    app.include_router(agent_router)

    @app.exception_handler(ResearchTaskNotFound)
    async def handle_research_task_not_found(
        _request: Request,
        error: ResearchTaskNotFound,
    ) -> JSONResponse:
        body = ErrorResponse(
            error=ErrorDetail(
                code=error.code,
                message=str(error),
                trace_id=str(uuid4()),
            )
        )
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content=body.model_dump(mode="json"),
        )

    @app.exception_handler(ResearchStartProposalNotFound)
    async def handle_research_start_proposal_not_found(
        _request: Request,
        error: ResearchStartProposalNotFound,
    ) -> JSONResponse:
        body = ErrorResponse(
            error=ErrorDetail(
                code=ErrorCode.RESEARCH_START_PROPOSAL_NOT_FOUND,
                message=str(error),
                trace_id=str(uuid4()),
            )
        )
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content=body.model_dump(mode="json"),
        )

    @app.exception_handler(ResearchStartIdempotencyConflict)
    @app.exception_handler(ResearchStartProposalConflict)
    @app.exception_handler(ResearchStartSourceIncomplete)
    async def handle_research_start_conflict(
        _request: Request,
        error: Exception,
    ) -> JSONResponse:
        code = {
            ResearchStartIdempotencyConflict: ErrorCode.RESEARCH_START_IDEMPOTENCY_CONFLICT,
            ResearchStartProposalConflict: ErrorCode.RESEARCH_START_PROPOSAL_CONFLICT,
            ResearchStartSourceIncomplete: ErrorCode.RESEARCH_START_SOURCE_INCOMPLETE,
        }[type(error)]
        body = ErrorResponse(
            error=ErrorDetail(code=code, message=str(error), trace_id=str(uuid4()))
        )
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=body.model_dump(mode="json"),
        )

    @app.exception_handler(SharedKnowledgeValidationError)
    async def handle_shared_validation(_request: Request, error):
        body = ErrorResponse(
            error=ErrorDetail(
                code=ErrorCode.VALIDATION_ERROR, message=str(error), trace_id=str(uuid4())
            )
        )
        return JSONResponse(status_code=422, content=body.model_dump(mode="json"))

    @app.exception_handler(SharedKnowledgeUnavailable)
    @app.exception_handler(SharedKnowledgeForbidden)
    async def handle_shared_knowledge_error(_request: Request, error):
        forbidden = isinstance(error, SharedKnowledgeForbidden)
        body = ErrorResponse(
            error=ErrorDetail(
                code=ErrorCode.FORBIDDEN if forbidden else ErrorCode.NOT_FOUND,
                message=str(error),
                trace_id=str(uuid4()),
            )
        )
        return JSONResponse(
            status_code=403 if forbidden else 404, content=body.model_dump(mode="json")
        )

    @app.exception_handler(ConversationNotFound)
    async def handle_agent_conversation_not_found(
        _request: Request,
        _error: ConversationNotFound,
    ) -> JSONResponse:
        body = ErrorResponse(
            error=ErrorDetail(
                code=ErrorCode.NOT_FOUND,
                message="对话不存在或无权访问。",
                trace_id=str(uuid4()),
            )
        )
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content=body.model_dump(mode="json"),
        )

    @app.exception_handler(IdentityError)
    async def handle_identity_error(
        _request: Request,
        error: IdentityError,
    ) -> JSONResponse:
        if isinstance(error, VerificationCodeRateLimited):
            status_code = status.HTTP_429_TOO_MANY_REQUESTS
        elif isinstance(error, EmailDeliveryUnavailable):
            status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        elif isinstance(error, EmailAlreadyRegistered):
            status_code = status.HTTP_409_CONFLICT
        elif isinstance(error, (InvalidEmail, InvalidVerificationCode)):
            status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
        else:
            status_code = status.HTTP_401_UNAUTHORIZED
        code = {
            status.HTTP_401_UNAUTHORIZED: ErrorCode.UNAUTHENTICATED,
            status.HTTP_429_TOO_MANY_REQUESTS: ErrorCode.EMAIL_VERIFICATION_RATE_LIMITED,
            status.HTTP_503_SERVICE_UNAVAILABLE: ErrorCode.EMAIL_DELIVERY_UNAVAILABLE,
        }.get(status_code, ErrorCode.VALIDATION_ERROR)
        body = ErrorResponse(
            error=ErrorDetail(
                code=code,
                message=str(error),
                trace_id=str(uuid4()),
            )
        )
        response = JSONResponse(
            status_code=status_code,
            content=body.model_dump(mode="json"),
        )
        if isinstance(error, VerificationCodeRateLimited):
            response.headers["Retry-After"] = str(error.retry_after_seconds)
        if isinstance(error, Unauthenticated):
            response.delete_cookie(
                resolved_settings.session_cookie_name,
                path="/",
                secure=resolved_settings.session_cookie_secure,
                httponly=True,
                samesite=resolved_settings.session_cookie_samesite,
            )
        return response

    @app.exception_handler(ModelInvocationError)
    async def handle_model_invocation_error(
        _request: Request,
        error: ModelInvocationError,
    ) -> JSONResponse:
        public_code, response_status = {
            "model_timeout": (
                ErrorCode.MODEL_TIMEOUT,
                status.HTTP_503_SERVICE_UNAVAILABLE,
            ),
            "model_unavailable": (
                ErrorCode.MODEL_TIMEOUT,
                status.HTTP_503_SERVICE_UNAVAILABLE,
            ),
            "model_rate_limited": (
                ErrorCode.MODEL_TIMEOUT,
                status.HTTP_429_TOO_MANY_REQUESTS,
            ),
            "model_invalid_output": (
                ErrorCode.INTERNAL_SERVER_ERROR,
                status.HTTP_502_BAD_GATEWAY,
            ),
            "model_request_rejected": (
                ErrorCode.INTERNAL_SERVER_ERROR,
                status.HTTP_502_BAD_GATEWAY,
            ),
            "no_reliable_candidate": (
                ErrorCode.NO_RELIABLE_CANDIDATE,
                status.HTTP_409_CONFLICT,
            ),
            "insufficient_sources": (
                ErrorCode.INSUFFICIENT_SOURCES,
                status.HTTP_409_CONFLICT,
            ),
        }[error.code]
        body = ErrorResponse(
            error=ErrorDetail(
                code=public_code,
                message=str(error),
                trace_id=str(error.trace_id),
            )
        )
        return JSONResponse(
            status_code=response_status,
            content=body.model_dump(mode="json"),
        )

    @app.exception_handler(MemoryValidationError)
    async def handle_memory_validation_error(
        _request: Request, error: MemoryValidationError
    ) -> JSONResponse:
        body = ErrorResponse(
            error=ErrorDetail(code="validation_error", message=str(error), trace_id=str(uuid4()))
        )
        return JSONResponse(status_code=422, content=body.model_dump(mode="json"))

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation_error(
        _request: Request,
        _error: RequestValidationError,
    ) -> JSONResponse:
        body = ErrorResponse(
            error=ErrorDetail(
                code="validation_error",
                message="Request validation failed.",
                trace_id=str(uuid4()),
            )
        )
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content=body.model_dump(mode="json"),
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(
        _request: Request,
        error: StarletteHTTPException,
    ) -> JSONResponse:
        code, message = {
            status.HTTP_401_UNAUTHORIZED: (
                ErrorCode.UNAUTHENTICATED,
                "Authentication required.",
            ),
            status.HTTP_404_NOT_FOUND: (
                ErrorCode.NOT_FOUND,
                "Resource not found.",
            ),
            status.HTTP_405_METHOD_NOT_ALLOWED: (
                ErrorCode.METHOD_NOT_ALLOWED,
                "Method not allowed.",
            ),
        }.get(
            error.status_code,
            (
                ErrorCode.VALIDATION_ERROR
                if error.status_code < 500
                else ErrorCode.INTERNAL_SERVER_ERROR,
                "Request failed." if error.status_code < 500 else "Internal server error.",
            ),
        )
        body = ErrorResponse(
            error=ErrorDetail(
                code=code,
                message=message,
                trace_id=str(uuid4()),
            )
        )
        return JSONResponse(
            status_code=error.status_code,
            content=body.model_dump(mode="json"),
        )

    install_account_management(
        app,
        database=resolved_database,
        password_hasher=password_hasher,
    )

    return app


def _retriever_from_settings(settings: Settings) -> HybridRetriever | None:
    configured_values = (
        settings.embedding_base_url,
        settings.embedding_api_key,
        settings.embedding_model,
        settings.reranker_base_url,
        settings.reranker_api_key,
        settings.reranker_model,
    )
    if settings.allow_model_fallback and not all(configured_values):
        # Real lexical search remains available; do not invent embeddings/rankings.
        return None
    has_partial_configuration = any(value is not None for value in configured_values)
    if not has_partial_configuration and (
        settings.runtime_mode == "mock" or settings.has_model_api_key
    ):
        return None
    config = settings.require_retrieval_config()
    embedder = OpenAICompatibleEmbeddingProvider(
        base_url=config.embedding_base_url,
        api_key=config.embedding_api_key.get_secret_value(),
        model=config.embedding_model,
        timeout_seconds=config.embedding_timeout_seconds,
    )
    reranker = SiliconFlowRerankerProvider(
        base_url=config.reranker_base_url,
        api_key=config.reranker_api_key.get_secret_value(),
        model=config.reranker_model,
        timeout_seconds=config.reranker_timeout_seconds,
    )
    return HybridRetriever(
        index=SqliteRetrievalIndex(config.index_path),
        embedder=embedder,
        embedding_model=config.embedding_model,
        chunk_schema_version=RETRIEVAL_CORPUS_SCHEMA_VERSION,
        reranker=reranker,
        reranker_model=config.reranker_model,
        min_rerank_score=config.min_rerank_score,
        min_lexical_score=config.min_lexical_score,
        recall_limit=config.recall_limit,
    )


def _model_provider_from_settings(
    *,
    settings: Settings,
    builtin_case_catalog: BuiltInCaseCatalog,
    database: Database,
    endpoints: tuple[ModelEndpoint, ...],
    probe_transport: httpx.AsyncBaseTransport | None,
) -> tuple[
    ModelProvider,
    ModelRouteExecutor | None,
    SqliteModelAttemptRecorder | None,
]:
    runtime_mode = _effective_model_runtime_mode(settings)
    if runtime_mode == "mock":
        return create_deterministic_mock_provider(catalog=builtin_case_catalog), None, None
    if not endpoints:
        raise ValueError(
            "EVERPLAIN_MODEL_BASE_URL (model_base_url) and "
            "EVERPLAIN_MODEL_NAME (model_name) are required outside mock mode"
        )

    providers: tuple[ProbeableModelProvider, ...] = tuple(
        OpenAICompatibleModelProvider(
            require_billing=True,
            base_url=endpoint.base_url,
            api_key=endpoint.api_key,
            model=endpoint.model,
            timeout_seconds=endpoint.timeout_seconds,
            capability_tier=runtime_mode,
            extra_headers=dict(endpoint.extra_headers),
            probe_transport=probe_transport,
            max_input_tokens=settings.model_max_input_tokens,
            max_output_tokens=settings.model_max_output_tokens,
        )
        for endpoint in endpoints
    )
    attempt_recorder = SqliteModelAttemptRecorder(database)
    router = ModelRouteExecutor(
        endpoints=endpoints,
        recorder=attempt_recorder,
        max_retries=settings.model_max_retries,
    )
    return (
        RoutedModelProvider(providers=providers, router=router),
        router,
        attempt_recorder,
    )


def _model_endpoints_from_settings(settings: Settings) -> tuple[ModelEndpoint, ...]:
    headers = _model_headers_from_settings(settings)
    return tuple(
        ModelEndpoint(
            endpoint_id=endpoint.endpoint_id,
            base_url=endpoint.base_url,
            api_key=(endpoint.api_key.get_secret_value() if endpoint.api_key is not None else None),
            model=endpoint.model,
            timeout_seconds=endpoint.timeout_seconds,
            provider="openai-compatible",
            extra_headers=dict(headers),
        )
        for endpoint in settings.resolved_model_endpoints()
    )


def _effective_model_runtime_mode(settings: Settings) -> str:
    """Resolve the runtime selected by the actual model credentials."""

    if settings.allow_model_fallback and not settings.has_model_api_key:
        return "mock"
    if settings.runtime_mode == "mock" and settings.has_model_api_key:
        return "base"
    return settings.runtime_mode


def _model_headers_from_settings(settings: Settings) -> dict[str, str]:
    headers = {
        name: value.get_secret_value() for name, value in settings.model_extra_headers.items()
    }
    if settings.runtime_mode == "sft" and settings.model_sft_resource_id is not None:
        header_name = settings.model_sft_resource_header
        if header_name.lower() in {name.lower() for name in headers}:
            raise ValueError("SFT resource header duplicates a model extension header")
        headers[header_name] = settings.model_sft_resource_id.get_secret_value()
    return headers


def _billing_runtime(settings, database):
    from qunxue_api.adapters.model.tariff_config import configured_model_tariffs
    from qunxue_api.adapters.sqlite.durable_billing import DurableBilling
    from qunxue_api.modules.billing import PriceBook, TavilyPrice

    fields = (
        settings.billing_price_version,
        settings.billing_max_attempt_usd_micro,
        settings.billing_max_operation_usd_micro,
        settings.billing_daily_budget_usd_micro,
    )
    if any(value is None for value in fields):
        return None
    fx_fields = (
        settings.billing_fx_cny_per_usd_micro, settings.billing_fx_snapshot_id,
        settings.billing_fx_as_of, settings.billing_fx_source,
    )
    if any(value is not None for value in fx_fields):
        if any(value is None for value in fx_fields):
            return None
        conversion = dict(
            credits_per_usd=None, points_per_cny=100, retail_rate_ppm=100000,
            fx_cny_per_usd_micro=settings.billing_fx_cny_per_usd_micro,
            fx_snapshot_id=settings.billing_fx_snapshot_id,
            fx_as_of=settings.billing_fx_as_of, fx_source=settings.billing_fx_source,
        )
    elif settings.billing_credits_per_usd is not None:
        # Compatibility for explicit legacy snapshots; no inferred conversion.
        conversion = dict(credits_per_usd=settings.billing_credits_per_usd)
    else:
        return None
    return DurableBilling(
        database.engine,
        price_book=PriceBook(
            **conversion,
            version=settings.billing_price_version,
            tariffs=configured_model_tariffs(settings),
            aliases=settings.billing_model_aliases,
            usage_policies=settings.billing_usage_policies,
            deepseek_time_basis=settings.billing_deepseek_time_basis,
            calendar_version=settings.billing_calendar_version,
            tavily_price=(
                TavilyPrice(**settings.billing_tavily_price.model_dump())
                if settings.billing_tavily_price else None
            ),
        ),
        max_attempt_pico=settings.billing_max_attempt_usd_micro * 10**6,
        max_operation_pico=settings.billing_max_operation_usd_micro * 10**6,
        daily_budget_pico=settings.billing_daily_budget_usd_micro * 10**6,
        max_attempts=settings.billing_max_attempts,
        plan_limits=settings.billing_plan_weekly_points,
    )
