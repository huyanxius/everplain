"""Loopback-only contract fixture. Real Everplain app; only model/provider edges are synthetic."""

import json
import os
import threading
import time
from contextlib import contextmanager
from pathlib import Path

import uvicorn
from alembic import command
from alembic.config import Config
from fastapi import Request
from fastapi.responses import JSONResponse, StreamingResponse
from qunxue_api.adapters.sqlite.database import Database
from qunxue_api.bootstrap import create_app
from qunxue_api.modules.agent_conversation import AgentRunResult
from qunxue_api.settings import Settings
from sqlalchemy import text

if os.environ.get("EVERPLAIN_GATEWAY_CONTRACT_TEST") != "1":
    raise RuntimeError("This synthetic fixture must never be used as a production app")

ROOT = Path(__file__).resolve().parents[2]
DATABASE = os.environ["EVERPLAIN_DATABASE_URL"]
SECRET = "synthetic-gateway-secret-not-a-real-credential"
settings = Settings(
    _env_file=None,
    database_url=DATABASE,
    runtime_mode="mock",
    cors_allowed_origins=("http://127.0.0.1:18593",),
    channel_gateway_credentials={"telegram:123": SECRET, "feishu:cli_test:tenant_test": SECRET},
    channel_gateway_display={
        "telegram:123": {"name": "Telegram 本地验收"},
        "feishu:cli_test:tenant_test": {"name": "飞书本地验收"},
    },
)
config = Config(str(ROOT / "backend/alembic.ini"))
config.set_main_option("script_location", str(ROOT / "backend/migrations"))
command.upgrade(config, "head")
database = Database(DATABASE)
with database.engine.begin() as connection:
    connection.execute(text("CREATE TABLE IF NOT EXISTS fixture_model_calls (prompt TEXT)"))
    connection.execute(
        text("CREATE TABLE IF NOT EXISTS fixture_deliveries (platform TEXT, body TEXT)")
    )
app = create_app(settings=settings, database=database, require_email_verification=False)
original_runtime = app.state.disciplinary_agent_scope
behavior = {"telegram": "success", "feishu": "success", "dispatch": "success"}
model_release = threading.Event()
dispatch_requests = 0


@app.middleware("http")
async def dispatch_response_fault(request, call_next):
    global dispatch_requests
    is_dispatch = request.url.path == "/api/channel-gateway/dispatch"
    if is_dispatch:
        dispatch_requests += 1
    response = await call_next(request)
    # Lose only the HTTP result, after the real dispatch transaction committed.
    if is_dispatch and response.status_code in {200, 202} and behavior["dispatch"] in {
        "drop_once", "truncate_once"
    }:
        mode = behavior["dispatch"]
        behavior["dispatch"] = "success"
        if mode == "truncate_once":
            # Real HTTP framing failure: uvicorn closes an incomplete body and
            # the gateway's HTTP client raises while reading the 200 response.
            return StreamingResponse(iter([b"{"]), headers={"Content-Length": "10"})
        return JSONResponse({"detail": "synthetic response loss"}, status_code=503)
    return response


class SyntheticModel:
    def run_stream(self, *, prompt, conversation, on_checkpoint, **kwargs):
        on_checkpoint()
        with database.engine.begin() as connection:
            connection.execute(
                text("INSERT INTO fixture_model_calls VALUES (:prompt)"), {"prompt": prompt}
            )
        answer = "private fixture answer: " + prompt
        if prompt == "gated cancellable reply":
            kwargs["on_delta"]("private persisted fixture prefix")
        if prompt == "long unicode reply":
            answer = "知识🙂" * 3000
        if prompt in {"gated long reply", "gated cancellable reply"} and not model_release.wait(90):
            raise RuntimeError("Synthetic model gate was not released")
        return AgentRunResult(
            answer=answer,
            citations=(),
            release_id="",
            provider="synthetic",
            model="test",
            input_tokens=1,
            output_tokens=1,
        )


@contextmanager
def runtime():
    with original_runtime() as application:
        application._runner = SyntheticModel()
        yield application


app.state.disciplinary_agent_scope = runtime


@app.get("/__fixture/state")
def state():
    with database.engine.connect() as connection:
        return {
            "calls": list(connection.scalars(text("SELECT prompt FROM fixture_model_calls"))),
            "deliveries": [
                {"platform": row[0], "body": json.loads(row[1])}
                for row in connection.execute(text("SELECT platform,body FROM fixture_deliveries"))
            ],
            "runs": connection.scalar(text("SELECT count(*) FROM agent_runs")),
            "charges": connection.scalar(
                text("SELECT count(*) FROM credit_ledger WHERE kind='usage'")
            ),
            "run_states": list(connection.scalars(text("SELECT status FROM agent_runs"))),
            "dispatch_requests": dispatch_requests,
        }


@app.post("/__fixture/behavior/{platform}/{mode}")
def set_behavior(platform: str, mode: str):
    assert platform in behavior and mode in {
        "success", "rate_once", "ambiguous_once", "permanent_once", "drop_once", "truncate_once"
    }
    behavior[platform] = mode
    return {"set": True}


@app.post("/__fixture/model/release")
def release_model():
    model_release.set()
    return {"released": True}


def record(platform, body):
    with database.engine.begin() as connection:
        connection.execute(
            text("INSERT INTO fixture_deliveries VALUES (:platform,:body)"),
            {"platform": platform, "body": json.dumps(body, ensure_ascii=False)},
        )
    mode = behavior[platform]
    behavior[platform] = "success"
    return mode


@app.post("/bot{token}/sendMessage")
async def telegram_send(token: str, request: Request):
    assert token.startswith("123:")
    body = dict(await request.form())
    mode = record("telegram", body)
    if mode == "rate_once":
        return JSONResponse(
            {
                "ok": False,
                "error_code": 429,
                "description": "fixture rate limit",
                "parameters": {"retry_after": 1},
            },
            status_code=429,
        )
    if mode == "ambiguous_once":
        return JSONResponse(
            {"ok": False, "error_code": 500, "description": "fixture lost result"}, status_code=500
        )
    if mode == "permanent_once":
        return JSONResponse(
            {"ok": False, "error_code": 403, "description": "fixture bot blocked"}, status_code=403
        )
    return {
        "ok": True,
        "result": {
            "message_id": 12345,
            "date": int(time.time()),
            "chat": {"id": int(body["chat_id"]), "type": "private"},
            "text": body["text"],
        },
    }


@app.post("/open-apis/auth/v3/tenant_access_token/internal")
def feishu_token():
    return {"code": 0, "msg": "ok", "tenant_access_token": "synthetic-local-token", "expire": 7200}


@app.post("/open-apis/im/v1/messages")
async def feishu_send(request: Request):
    body = await request.json()
    mode = record("feishu", body)
    if mode == "rate_once":
        return JSONResponse({"code": 230020, "msg": "fixture rate limit"}, status_code=400)
    if mode == "ambiguous_once":
        return JSONResponse({"code": 500, "msg": "fixture lost result"}, status_code=500)
    return {"code": 0, "msg": "ok", "data": {"message_id": "om_fixture_answer"}}


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ["FIXTURE_BACKEND_PORT"]),
        access_log=False,
        log_level="warning",
    )
