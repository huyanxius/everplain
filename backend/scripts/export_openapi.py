import json
from pathlib import Path

from qunxue_api.api.routes.account_management import routers
from qunxue_api.api.routes.frameworks import router as legacy_frameworks_router
from qunxue_api.api.routes.knowledge import router as legacy_knowledge_router
from qunxue_api.api.routes.matching import router as legacy_matching_router
from qunxue_api.api.routes.phenomena import example_router as legacy_examples_router
from qunxue_api.bootstrap import create_app
from qunxue_api.settings import Settings

# Contract generation must not read deployment credentials or mutate a live database.
app = create_app(settings=Settings(
    _env_file=None, runtime_mode="mock", database_url="sqlite:///:memory:",
    model_api_key=None, model_base_url=None, model_name=None, model_fallbacks=[],
    account_initial_admin_email="", account_initial_admin_password=None,
))
# Shared source modules still reference historic types for document compatibility.
# These contracts are generated only; create_app never serves these legacy APIs.
for router in (*routers, legacy_knowledge_router, legacy_matching_router,
               legacy_frameworks_router, legacy_examples_router):
    app.include_router(router)


def main() -> None:
    output_path = Path(__file__).resolve().parents[1] / "openapi.json"
    content = json.dumps(
        app.openapi(),
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    )
    output_path.write_text(f"{content}\n", encoding="utf-8")


if __name__ == "__main__":
    main()
