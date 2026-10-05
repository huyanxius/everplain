"""Short SQLite transactions for reservations, paid attempts, exact credits and refunds.

No transaction remains open while calling a provider. Unknown provider cost stays
reserved across process restarts until an explicit receipt reconciles it.
"""

import json
import re
from contextlib import contextmanager, nullcontext
from dataclasses import asdict
from datetime import UTC, datetime
from fractions import Fraction
from math import ceil
from uuid import NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import text

from qunxue_api.adapters.sqlite.quota_periods import (
    ensure_quota_period,
    get_quota_period,
    settle_quota_period,
)
from qunxue_api.modules.billing import (
    PICO_USD,
    BillingContextMissing,
    PriceBook,
    Tariff,
    TavilyPrice,
    UnknownPrice,
)
from qunxue_api.modules.billing import (
    BillingBudgetExceeded as BillingBudgetExceeded,
)
from qunxue_api.modules.billing import (
    BillingReplayBlocked as BillingReplayBlocked,
)
from qunxue_api.modules.billing import (
    BillingRouteMismatch as BillingRouteMismatch,
)

SCHEMA = (
    """CREATE TABLE billing_operations (
      run_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
      status TEXT NOT NULL, hold_points INTEGER NOT NULL CHECK(hold_points >= 0),
      exempt INTEGER NOT NULL, price_json TEXT NOT NULL, credit_pico TEXT NOT NULL DEFAULT '0',
      original_credit_pico TEXT NOT NULL DEFAULT '0',
      charged_points INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      quota_period_epoch INTEGER)""",
    """CREATE TABLE billing_attempts (
      attempt_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES billing_operations(run_id),
      endpoint_id TEXT NOT NULL, route_id TEXT, request_hash TEXT NOT NULL,
      requested_model TEXT NOT NULL, returned_model TEXT, provider_response_id TEXT,
      outcome TEXT NOT NULL, usage_state TEXT NOT NULL, billable INTEGER NOT NULL DEFAULT 0,
      input_limit INTEGER NOT NULL, output_limit INTEGER NOT NULL,
      reserved_cost_pico INTEGER NOT NULL CHECK(reserved_cost_pico >= 0),
      reference_cost_pico INTEGER, procurement_cost_pico INTEGER,
      input_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER,
      output_tokens INTEGER, reasoning_tokens INTEGER, raw_usage_json TEXT,
      provider_host TEXT, api_type TEXT, requested_effort TEXT, requested_service_tier TEXT,
      returned_service_tier TEXT, finish_reason TEXT,
      procurement_status TEXT NOT NULL DEFAULT 'pending',
      overrun_cost_pico INTEGER NOT NULL DEFAULT 0,
      failure_code TEXT, price_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      dispatch_state TEXT DEFAULT 'legacy_unknown' NOT NULL, provider_request_id TEXT)""",
    """CREATE TABLE billing_precision (
      user_id TEXT PRIMARY KEY, total_credit_pico TEXT NOT NULL)""",
    "CREATE INDEX ix_billing_operations_user_status ON billing_operations(user_id,status)",
    "CREATE INDEX ix_billing_attempts_run ON billing_attempts(run_id)",
    (
        "CREATE UNIQUE INDEX uq_billing_provider_receipt ON billing_attempts "
        "(provider_host,provider_response_id) WHERE provider_response_id IS NOT NULL"
    ),
)


def create_billing_tables(engine):
    """Create an empty billing namespace without changing accounts or old ledger rows."""
    with engine.begin() as conn:
        for statement in SCHEMA:
            conn.execute(text(statement))


class DurableBilling:
    def __init__(
        self,
        engine,
        *,
        price_book: PriceBook,
        max_attempt_pico: int,
        max_operation_pico: int,
        daily_budget_pico: int,
        max_attempts: int = 64,
        clock=None,
        billing_policy="actual_usage_v1",
        plan_limits=None,
    ):
        values = max_attempt_pico, max_operation_pico, daily_budget_pico, max_attempts
        if any(type(n) is not int or n <= 0 for n in values):
            raise ValueError("finite positive billing budgets are required")
        self.engine = engine
        self.book = price_book
        self.max_attempt_pico = max_attempt_pico
        self.max_operation_pico = max_operation_pico
        self.daily_budget_pico = daily_budget_pico
        self.max_attempts = max_attempts
        self.clock = clock or (lambda: datetime.now(UTC))
        if billing_policy not in {"actual_usage_v1", "actual_usage_v2", "delivery_v1"}:
            raise ValueError("unknown billing policy")
        self.billing_policy = billing_policy
        self.plan_limits = plan_limits

    @contextmanager
    def _transaction(self):
        with self.engine.connect() as conn:
            conn.execute(text("BEGIN IMMEDIATE"))
            try:
                yield conn
                conn.commit()
            except BaseException:
                conn.rollback()
                raise

    def _now(self):
        return self.clock().isoformat()

    @staticmethod
    def _one(conn, sql, **args):
        return conn.execute(text(sql), args).mappings().first()

    @staticmethod
    def _snapshot(book):
        return json.dumps(
            {
                "credits_per_usd": book.credits_per_usd,
                "version": book.version,
                "aliases": dict(book.aliases),
                "usage_policies": dict(book.usage_policies),
                "tariffs": {k: asdict(v) for k, v in book.tariffs.items()},
                "deepseek_time_basis": book.deepseek_time_basis,
                "calendar_version": book.calendar_version,
                "reference_band": book.reference_band,
                "dispatch_at": book.dispatch_at,
                "points_per_cny": book.points_per_cny,
                "retail_rate_ppm": book.retail_rate_ppm,
                "fx_cny_per_usd_micro": book.fx_cny_per_usd_micro,
                "fx_snapshot_id": book.fx_snapshot_id,
                "fx_as_of": book.fx_as_of,
                "fx_source": book.fx_source,
                "procurement_estimate_source": book.procurement_estimate_source,
                "procurement_estimate_ratio": book.procurement_estimate_ratio,
                "tavily_price": asdict(book.tavily_price) if book.tavily_price else None,
            },
            sort_keys=True,
        )

    @staticmethod
    def _book(snapshot):
        data = json.loads(snapshot)
        return PriceBook(
            credits_per_usd=data["credits_per_usd"],
            version=data["version"],
            aliases=data["aliases"],
            usage_policies=data.get("usage_policies", {}),
            deepseek_time_basis=data.get("deepseek_time_basis"),
            calendar_version=data.get("calendar_version"),
            reference_band=data.get("reference_band"),
            dispatch_at=data.get("dispatch_at"),
            **{name: data[name] for name in (
                "points_per_cny", "retail_rate_ppm", "fx_cny_per_usd_micro", "fx_snapshot_id",
                "fx_as_of", "fx_source",
                "procurement_estimate_source", "procurement_estimate_ratio",
            ) if name in data},
            tariffs={k: Tariff(**v) for k, v in data["tariffs"].items()},
            tavily_price=TavilyPrice(**data["tavily_price"]) if data.get("tavily_price") else None,
        )

    @staticmethod
    def _actual_usage(run):
        # Missing policy marks historical operations, not permission to reprice them.
        return json.loads(run["price_json"]).get("billing_policy") in {
            "actual_usage_v1", "actual_usage_v2"
        }

    @staticmethod
    def _independent_delivery(run):
        return json.loads(run["price_json"]).get("billing_policy") == "actual_usage_v2"

    def _confirmed_quota_exhausted(self, conn, run):
        if run["exempt"]:
            return False
        epoch = run.get("quota_period_epoch")
        period = get_quota_period(conn, run["user_id"], epoch) if epoch is not None else None
        account = period or self._one(conn,
            "SELECT balance FROM credit_accounts WHERE user_id=:u", u=run["user_id"])
        if account is None:
            return False
        precision = period or self._one(conn,
            "SELECT total_credit_pico FROM billing_precision WHERE user_id=:u", u=run["user_id"])
        exact = Fraction(precision["total_credit_pico"]) if precision else Fraction(0)
        remaining = max(Fraction(0), account["balance"] * PICO_USD - exact % PICO_USD)
        outstanding = Fraction(run["original_credit_pico"]) - Fraction(run["credit_pico"])
        return account["balance"] == 0 or (outstanding > 0 and outstanding >= remaining)

    def delivery_state(self, run_id):
        """Actual receipt certainty, settlement and delivery are separate facts."""
        with self.engine.connect() as conn:
            run = self._one(conn, "SELECT * FROM billing_operations WHERE run_id=:run",
                            run=str(run_id))
            if run is None:
                return {"usage_status": "pending", "settlement_status": "pending",
                        "quota_exhausted": False}
            attempts = conn.execute(text(
                "SELECT usage_state,outcome FROM billing_attempts WHERE run_id=:run"
            ), {"run": str(run_id)}).mappings().all()
            pending = any(a["usage_state"] not in {"known", "unpriced", "not_sent"}
                          for a in attempts)
            settlement_pending = any(a["usage_state"] not in {"known", "not_sent"}
                                     or a["outcome"] == "model_mismatch" for a in attempts)
            outstanding = (
                max(Fraction(0), Fraction(run["original_credit_pico"])
                    - Fraction(run["credit_pico"])) if self._independent_delivery(run) else 0
            )
            return {"usage_status": "pending" if pending else "known",
                    "settlement_status": ("pending" if settlement_pending or outstanding
                                          else "settled"),
                    "pending_credit_numerator": str(outstanding),
                    "quota_exhausted": self._confirmed_quota_exhausted(conn, run)}

    def uses_independent_delivery(self, run_id):
        with self.engine.connect() as conn:
            run = self._one(conn, "SELECT * FROM billing_operations WHERE run_id=:run",
                            run=str(run_id))
            return bool(run and self._independent_delivery(run))

    def _operation_snapshot(self, billing_policy=None):
        snapshot = json.loads(self._snapshot(self.book))
        snapshot["billing_policy"] = billing_policy or self.billing_policy
        return json.dumps(snapshot, sort_keys=True)

    def _available(self, conn, user_id):
        row = self._one(
            conn, "SELECT * FROM credit_accounts WHERE user_id=:user", user=user_id
        )
        if row is None:
            raise BillingBudgetExceeded("credit account is missing", reason="credits_depleted")
        held = conn.scalar(
            text(
                "SELECT coalesce(sum(hold_points),0) FROM billing_operations "
                "WHERE user_id=:user AND status='active' "
                + ("AND quota_period_epoch=:epoch" if row.get("quota_period_epoch") is not None
                   else "")
            ),
            {"user": user_id, "epoch": row.get("quota_period_epoch")},
        )
        return max(0, row["balance"] - held)

    def available_balance(self, user_id):
        with self.engine.connect() as conn:
            return self._available(conn, str(user_id))

    def start(self, *, user_id, run_id, fingerprint, exempt=False, resume=False, quota_start=True,
              billing_policy=None):
        if billing_policy not in {None, "actual_usage_v1", "actual_usage_v2", "delivery_v1"}:
            raise ValueError("unknown billing policy")
        run_id, user_id = str(run_id), str(user_id)
        with self._transaction() as conn:
            previous = self._one(
                conn, "SELECT * FROM billing_operations WHERE run_id=:run", run=run_id
            )
            if previous and (
                not resume or previous["status"] != "paused"
                or previous["user_id"] != user_id or bool(previous["exempt"]) != exempt
            ):
                raise BillingReplayBlocked("operation already exists; use its persisted outcome")
            if resume and previous is None:
                raise BillingReplayBlocked("paused billing operation is missing")
            book = self._book(previous["price_json"]) if previous else self.book
            actual_usage = self._actual_usage(previous) if previous else (
                (billing_policy or self.billing_policy) in {"actual_usage_v1", "actual_usage_v2"}
            )
            period = ensure_quota_period(
                conn, user_id, self.clock(), plan_limits=self.plan_limits, start=quota_start
            ) if actual_usage and not exempt else None
            if actual_usage and not exempt and not quota_start and period is None and conn.scalar(
                text("SELECT 1 FROM sqlite_master WHERE type='table' "
                     "AND name='credit_quota_periods'")
            ):
                raise BillingContextMissing(
                    "user quota period requires an accepted message",
                    reason="quota_period_not_started",
                )
            if previous and not exempt and not period:
                account = self._one(conn, "SELECT * FROM credit_accounts WHERE user_id=:user",
                                    user=user_id)
                epoch = account.get("quota_period_epoch") if account else None
                if epoch is not None and previous.get("quota_period_epoch") != epoch:
                    raise BillingReplayBlocked(
                        "paused operation belongs to an expired quota period"
                    )
            if previous and period and previous.get("quota_period_epoch") != period["epoch"]:
                raise BillingReplayBlocked("paused operation belongs to an expired quota period")
            independent = self._independent_delivery(previous) if previous else (
                (billing_policy or self.billing_policy) == "actual_usage_v2"
            )
            available = 0 if exempt else self._available(conn, user_id)
            if independent and not exempt:
                available = conn.scalar(text(
                    "SELECT balance FROM credit_accounts WHERE user_id=:user"), {"user": user_id})
                available = available or 0
            cap = ceil(Fraction(book.maximum_credit_numerator(self.max_operation_pico), PICO_USD))
            if previous:
                cap = max(0, cap - Fraction(previous["credit_pico"]) // PICO_USD)
            # Future operations do not freeze an entire turn's maximum budget.
            # Only before_attempt reserves the actual request about to be sent.
            hold = 0 if exempt or actual_usage else min(available, cap)
            if not exempt and available == 0:
                balance = conn.scalar(
                    text("SELECT balance FROM credit_accounts WHERE user_id=:user"),
                    {"user": user_id},
                )
                raise BillingBudgetExceeded(
                    "no available credits",
                    reason="credits_frozen" if balance else "credits_depleted",
                )
            now = self._now()
            if previous:
                conn.execute(
                    text("UPDATE billing_operations SET status='active', hold_points=:hold, "
                         "fingerprint=:fingerprint, updated_at=:now WHERE run_id=:run "
                         "AND status='paused'"),
                    {"hold": hold, "fingerprint": fingerprint, "now": now, "run": run_id},
                )
                return run_id
            conn.execute(
                text(
                    "INSERT INTO billing_operations "
                    "(run_id,user_id,fingerprint,status,hold_points,exempt,price_json,creat"
                    "ed_at,updated_at,quota_period_epoch) "
                    "VALUES (:run,:user,:fingerprint,'active',:hold,:exempt,:price,"
                    ":now,:now,:epoch)"
                ),
                {
                    "run": run_id,
                    "user": user_id,
                    "fingerprint": fingerprint,
                    "hold": hold,
                    "exempt": int(exempt),
                    "price": self._operation_snapshot(billing_policy),
                    "now": now,
                    "epoch": period["epoch"] if period else None,
                },
            )
        return run_id

    def _risk(self, conn):
        midnight = self.clock().astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        return conn.scalar(
            text(
                "SELECT coalesce(sum(CASE WHEN reference_cost_pico IS NULL "
                "THEN reserved_cost_pico WHEN updated_at >= :day THEN "
                "reference_cost_pico ELSE 0 END),0) "
                "FROM billing_attempts"
            ),
            {"day": midnight.isoformat()},
        )

    def operator_risk_pico(self):
        with self.engine.connect() as conn:
            return self._risk(conn)

    def before_attempt(
        self,
        *,
        run_id,
        endpoint_id,
        model,
        input_limit,
        output_limit,
        request_hash,
        route_id=None,
        provider_host=None,
        api_type="chat_completions",
        requested_effort=None,
        requested_service_tier=None,
    ):
        with self._transaction() as conn:
            run = self._one(
                conn, "SELECT * FROM billing_operations WHERE run_id=:run", run=str(run_id)
            )
            if run is None or run["status"] != "active":
                raise BillingReplayBlocked("operation is not active")
            if run.get("quota_period_epoch") is not None and not run["exempt"]:
                period = ensure_quota_period(
                    conn, run["user_id"], self.clock(), plan_limits=self.plan_limits, start=False
                )
                if period is None or period["epoch"] != run["quota_period_epoch"]:
                    raise BillingReplayBlocked("operation belongs to an expired quota period")
            independent = self._independent_delivery(run)
            if not independent and requested_service_tier not in {None, "default", "standard"}:
                raise UnknownPrice("requested service tier has no configured tariff")
            if independent and self._confirmed_quota_exhausted(conn, run):
                raise BillingBudgetExceeded("confirmed quota is exhausted",
                                            reason="credits_depleted")
            book = self._book(run["price_json"])
            try:
                book = book.lock_dispatch(model, self.clock())
            except UnknownPrice:
                if not independent:
                    raise
            if api_type == "tavily_search":
                if model != "tavily:basic" or input_limit != 1 or output_limit != 0:
                    raise UnknownPrice("only explicitly bounded Tavily basic search is supported")
                reserved = book.search_cost(1)
                new_credit = book.search_credit_numerator(reserved)
            elif independent:
                # This is an operator risk placeholder, never a token cap, a
                # wallet reservation, or confirmed provider/user consumption.
                reserved = self.max_attempt_pico
                new_credit = 0
            else:
                reserved = book.maximum_cost(model, input_limit, output_limit)
                new_credit = book.credit_numerator(reserved)
            attempts = conn.execute(
                text("SELECT * FROM billing_attempts WHERE run_id=:run"), {"run": str(run_id)}
            ).mappings().all()
            operation_risk = sum(
                a["reference_cost_pico"] if a["reference_cost_pico"] is not None
                else a["reserved_cost_pico"] for a in attempts
            ) + reserved
            user_credit = 0 if independent else sum(
                self._attempt_credit(a, reserved=a["outcome"] == "in_flight")
                for a in attempts if a["billable"] or a["outcome"] == "in_flight"
            ) + new_credit
            unsettled = max(0, user_credit - Fraction(run["credit_pico"]))
            max_credit = ceil(Fraction(unsettled, PICO_USD))
            actual_usage = self._actual_usage(run)
            if not independent and (
                reserved > self.max_attempt_pico
                or len(attempts) >= self.max_attempts
                or operation_risk > self.max_operation_pico
            ):
                raise BillingBudgetExceeded("model request exceeds reserved budget")
            if not independent and self._risk(conn) + reserved > self.daily_budget_pico:
                raise BillingBudgetExceeded(
                    "model service risk exceeds reserved budget", reason="service_budget_exceeded"
                )
            if not independent and not run["exempt"] and max_credit > (
                self._available(conn, run["user_id"]) + run["hold_points"]
                if actual_usage else run["hold_points"]
            ):
                raise BillingBudgetExceeded(
                    "request needs more available credits", reason="credits_depleted"
                )
            attempt = str(uuid4())
            now = self._now()
            conn.execute(
                text(
                    "INSERT INTO billing_attempts "
                    "(attempt_id,run_id,endpoint_id,route_id,request_hash,requested_model,o"
                    "utcome,usage_state,"
                    "input_limit,output_limit,reserved_cost_pico,price_json,provider_host,a"
                    "pi_type,requested_effort,requested_service_tier,created_at,updated_at)"
                    " "
                    "VALUES "
                    "(:id,:run,:endpoint,:route,:hash,:model,'in_flight','unknown',:i,:o,:c"
                    "ost,"
                    ":price,:provider,:api,:effort,:tier,:now,:now)"
                ),
                {
                    "id": attempt,
                    "run": str(run_id),
                    "endpoint": endpoint_id,
                    "route": str(route_id) if route_id else None,
                    "hash": request_hash,
                    "model": model,
                    "i": input_limit,
                    "o": output_limit,
                    "cost": reserved,
                    "price": self._snapshot(book),
                    "provider": provider_host,
                    "api": api_type,
                    "effort": requested_effort,
                    "tier": requested_service_tier,
                    "now": now,
                },
            )
            conn.execute(
                text("UPDATE billing_attempts SET dispatch_state='prepared' WHERE attempt_id=:id"),
                {"id": attempt},
            )
            conn.execute(
                text("UPDATE billing_operations SET updated_at=:now,hold_points=:hold "
                     "WHERE run_id=:run"),
                {"now": now, "run": str(run_id),
                 "hold": 0 if independent else max_credit
                    if actual_usage and not run["exempt"] else run["hold_points"]},
            )
        return attempt

    def mark_dispatch_started(self, attempt_id):
        with self._transaction() as conn:
            conn.execute(text("UPDATE billing_attempts SET dispatch_state='dispatch_started' "
                              "WHERE attempt_id=:id AND dispatch_state='prepared'"),
                         {"id": attempt_id})

    def record_response_received(self, attempt_id, provider_request_id=None):
        if provider_request_id is not None and (
            not isinstance(provider_request_id, str)
            or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,199}", provider_request_id) is None
        ):
            provider_request_id = None
        with self._transaction() as conn:
            conn.execute(text("UPDATE billing_attempts SET "
                              "dispatch_state=CASE WHEN usage_state='known' THEN 'usage_confirmed' "
                              "ELSE 'response_received' END, "
                              "provider_request_id=coalesce(provider_request_id,:receipt) "
                              "WHERE attempt_id=:id AND dispatch_state!='not_sent'"),
                         {"id": attempt_id, "receipt": provider_request_id})

    def release_proven_not_sent(self, attempt_id):
        # Only the supported transport's terminal pre-send connection evidence
        # calls this. Legacy rows, crashes and absent trace cannot reach it.
        with self._transaction() as conn:
            released = bool(conn.execute(text(
                "UPDATE billing_attempts SET dispatch_state='not_sent',outcome='error',"
                "usage_state='not_sent',billable=0,reference_cost_pico=0,"
                "failure_code='transport_proven_not_sent',updated_at=:now "
                "WHERE attempt_id=:id AND dispatch_state='prepared' "
                "AND reference_cost_pico IS NULL"
            ), {"id": attempt_id, "now": self._now()}).rowcount)
            if released:
                row = self._one(conn, "SELECT run_id FROM billing_attempts WHERE attempt_id=:id",
                                id=attempt_id)
                self._settle_actual(conn, row["run_id"])
            return released

    def pending_reconciliation(self, *, limit=50):
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError("reconciliation batch must be between 1 and 100")
        with self.engine.connect() as conn:
            return [dict(row) for row in conn.execute(text(
                "SELECT a.attempt_id,a.provider_host,a.provider_request_id,a.requested_model,"
                "a.dispatch_state,a.failure_code,a.created_at,a.updated_at,a.reserved_cost_pico "
                "FROM billing_attempts a JOIN billing_operations o ON o.run_id=a.run_id "
                "WHERE a.reference_cost_pico IS NULL AND o.status!='active' "
                "ORDER BY a.created_at,a.attempt_id LIMIT :limit"
            ), {"limit": limit}).mappings()]

    def reconcile_usage(self, *, attempt_id, provider_host, provider_request_id, model,
                        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens):
        from qunxue_api.adapters.model.token_usage import normalized_usage

        normalized_usage({
            "input_tokens": input_tokens, "output_tokens": output_tokens,
            "input_tokens_details": {"cached_tokens": cache_read_tokens,
                                     "cache_write_tokens": cache_write_tokens},
        })
        return self.complete_attempt(
            attempt_id=attempt_id, returned_model=model,
            input_tokens=input_tokens, output_tokens=output_tokens,
            cache_read_tokens=cache_read_tokens, cache_write_tokens=cache_write_tokens,
            raw_usage_json=json.dumps({
                "input_tokens": input_tokens, "output_tokens": output_tokens,
                "cache_read_tokens": cache_read_tokens, "cache_write_tokens": cache_write_tokens,
            }, sort_keys=True),
            reconciliation_receipt=(provider_host, provider_request_id),
        )

    def risk_breakdown(self):
        midnight = self.clock().astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        with self.engine.connect() as conn:
            row = self._one(conn, "SELECT "
                            "coalesce(sum(CASE WHEN a.reference_cost_pico IS NOT NULL AND "
                            "a.updated_at>=:day THEN a.reference_cost_pico "
                            "ELSE 0 END),0) known_today,"
                            "coalesce(sum(CASE WHEN a.reference_cost_pico IS NULL "
                            "AND o.status='active' "
                            "THEN a.reserved_cost_pico ELSE 0 END),0) active_reserved,"
                            "coalesce(sum(CASE WHEN a.reference_cost_pico IS NULL "
                            "AND o.status!='active' "
                            "THEN a.reserved_cost_pico ELSE 0 END),0) pending_unknown "
                            "FROM billing_attempts a JOIN billing_operations o "
                            "ON o.run_id=a.run_id",
                            day=midnight.isoformat())
            return dict(row)

    def _attempt_credit(self, attempt, *, reserved=False):
        book = self._book(attempt["price_json"])
        cost = attempt["reserved_cost_pico"] if reserved else attempt["reference_cost_pico"] or 0
        if attempt["api_type"] == "tavily_search":
            return book.search_credit_numerator(cost)
        return book.credit_numerator(cost)

    def _settle_actual(self, conn, run_id, *, receipt_attempt_id=None):
        """Debit confirmed usage and retain capacity only for live HTTP attempts.

        This is inside the attempt's receipt transaction, so a crash cannot leave
        a confirmed charge without its receipt, or apply the same receipt twice.
        Unknown terminal attempts stay in operator risk, never in the wallet hold.
        """
        run = self._one(conn, "SELECT * FROM billing_operations WHERE run_id=:run", run=run_id)
        if run is None or not self._actual_usage(run) or run["status"] != "active":
            return
        attempts = conn.execute(text("SELECT * FROM billing_attempts WHERE run_id=:run"),
                                {"run": run_id}).mappings().all()
        numerator = sum(self._attempt_credit(a) for a in attempts if a["billable"])
        remaining = sum(self._attempt_credit(a, reserved=True) for a in attempts
                        if a["outcome"] == "in_flight")
        if self._independent_delivery(run):
            return self._settle_independent(conn, run, numerator, receipt_attempt_id)
        points = 0
        if not run["exempt"]:
            epoch = run.get("quota_period_epoch")
            period = get_quota_period(conn, run["user_id"], epoch) if epoch is not None else None
            if epoch is not None and period is None:
                raise BillingReplayBlocked("operation quota period is missing")
            previous = period or self._one(
                conn, "SELECT total_credit_pico FROM billing_precision WHERE user_id=:u",
                u=run["user_id"]
            )
            old_total = Fraction(previous["total_credit_pico"]) if previous else 0
            new_total = old_total - Fraction(run["credit_pico"]) + numerator
            points = new_total // PICO_USD - old_total // PICO_USD
            # Existing provider-overrun/mismatch guards remain. Confirmed ordinary
            # usage must fit its own live reservation, never another run's funds.
            account = period or self._one(
                conn, "SELECT balance FROM credit_accounts WHERE user_id=:u", u=run["user_id"]
            )
            if points < 0 or points > run["hold_points"] or points > account["balance"]:
                raise BillingBudgetExceeded("confirmed usage exceeds available credits",
                                            reason="credits_depleted")
            if new_total != old_total:
                if period:
                    settle_quota_period(conn, run["user_id"], epoch,
                                        account["balance"] - points, str(new_total), self.clock())
                else:
                    conn.execute(text(
                        "INSERT INTO billing_precision(user_id,total_credit_pico) "
                        "VALUES (:u,:total) ON CONFLICT(user_id) DO UPDATE SET "
                        "total_credit_pico=excluded.total_credit_pico"
                    ), {"u": run["user_id"], "total": str(new_total)})
                    conn.execute(text(
                        "UPDATE credit_accounts SET balance=balance-:points,updated_at=:now "
                        "WHERE user_id=:u"
                    ), {"u": run["user_id"], "points": points, "now": self._now()})
                self._ledger(conn, run, -points, credit_numerator=numerator,
                             receipt_attempt_id=receipt_attempt_id)
        conn.execute(text(
            "UPDATE billing_operations SET credit_pico=:exact,original_credit_pico=:exact,"
            "charged_points=charged_points+:points,hold_points=:hold,updated_at=:now "
            "WHERE run_id=:run"
        ), {"run": run_id, "exact": str(numerator), "points": points,
            "hold": 0 if run["exempt"] else ceil(Fraction(remaining, PICO_USD)),
            "now": self._now()})

    def _settle_independent(self, conn, run, numerator, receipt_attempt_id):
        """Apply only newly confirmed usage; any unfunded remainder stays pending.

        original_credit_pico is the full actual numerator for v2, credit_pico is
        the applied numerator. The difference is neither waived nor an automatic
        debt collection. Finish/repeated receipts never apply that remainder.
        """
        prior_gross = Fraction(run["original_credit_pico"])
        applied = Fraction(run["credit_pico"])
        new_usage = max(Fraction(0), numerator - prior_gross)
        points = 0
        if not run["exempt"] and new_usage:
            epoch = run.get("quota_period_epoch")
            period = get_quota_period(conn, run["user_id"], epoch) if epoch is not None else None
            if epoch is not None and period is None:
                raise BillingReplayBlocked("operation quota period is missing")
            previous = period or self._one(conn,
                "SELECT total_credit_pico FROM billing_precision WHERE user_id=:u",
                u=run["user_id"])
            old_total = Fraction(previous["total_credit_pico"]) if previous else Fraction(0)
            account = period or self._one(conn,
                "SELECT balance FROM credit_accounts WHERE user_id=:u", u=run["user_id"])
            # Integer cash/credits cannot go negative. Preserve the complete cost
            # above this capacity as pending, without silently zeroing its facts.
            capacity = max(Fraction(0), account["balance"] * PICO_USD - old_total % PICO_USD)
            accepted = min(new_usage, capacity)
            new_total = old_total + accepted
            points = new_total // PICO_USD - old_total // PICO_USD
            applied += accepted
            if accepted:
                if period:
                    settle_quota_period(conn, run["user_id"], epoch,
                                        account["balance"] - points, str(new_total), self.clock())
                else:
                    conn.execute(text(
                        "INSERT INTO billing_precision(user_id,total_credit_pico) "
                        "VALUES (:u,:total) ON CONFLICT(user_id) DO UPDATE SET "
                        "total_credit_pico=excluded.total_credit_pico"
                    ), {"u": run["user_id"], "total": str(new_total)})
                    conn.execute(text(
                        "UPDATE credit_accounts SET balance=balance-:points,updated_at=:now "
                        "WHERE user_id=:u"
                    ), {"u": run["user_id"], "points": points, "now": self._now()})
                self._ledger(conn, run, -points, credit_numerator=applied,
                             receipt_attempt_id=receipt_attempt_id)
        elif run["exempt"]:
            applied = numerator
        conn.execute(text(
            "UPDATE billing_operations SET credit_pico=:applied,original_credit_pico=:gross,"
            "charged_points=charged_points+:points,hold_points=0,updated_at=:now WHERE run_id=:run"
        ), {"run": run["run_id"], "applied": str(applied), "gross": str(numerator),
            "points": points, "now": self._now()})

    def complete_search_attempt(self, *, attempt_id, credits=None, receipt=None,
                                outcome="error", failure_code=None):
        """Record one actual provider request, without pretending credits are tokens."""
        exceeded = duplicate = False
        with self._transaction() as conn:
            row = self._one(
                conn, "SELECT * FROM billing_attempts WHERE attempt_id=:id", id=attempt_id
            )
            if row is None or row["api_type"] != "tavily_search":
                raise BillingReplayBlocked("search attempt is missing")
            if row["usage_state"] in {"known", "not_sent"}:
                return
            valid = (
                type(credits) is int and 0 <= credits <= 1_000_000
                and isinstance(receipt, str) and 0 < len(receipt) <= 200
                and receipt == receipt.strip()
            )
            cost = self._book(row["price_json"]).search_cost(credits) if valid else None
            if valid:
                duplicate = self._one(
                    conn, "SELECT attempt_id FROM billing_attempts WHERE provider_host=:host "
                    "AND provider_response_id=:receipt AND attempt_id<>:id",
                    host=row["provider_host"], receipt=receipt, id=attempt_id,
                ) is not None
                exceeded = cost > row["reserved_cost_pico"] or credits > 1
                if duplicate:
                    # The original provider receipt remains authoritative. The
                    # duplicate observation has no additional provider cost.
                    cost, outcome, failure_code = 0, "rejected", "duplicate_provider_receipt"
                elif exceeded:
                    outcome, failure_code = "overrun", "search_usage_overrun"
            if not valid:
                outcome = "error"
                failure_code = failure_code or "search_usage_unknown"
            operation = self._one(
                conn, "SELECT * FROM billing_operations WHERE run_id=:run", run=row["run_id"]
            )
            if self._independent_delivery(operation):
                exceeded = False
            billable = valid and operation["status"] == "active" and (
                outcome == "success" or (self._actual_usage(operation)
                                         and not duplicate and not exceeded)
            )
            conn.execute(
                text("UPDATE billing_attempts SET outcome=:outcome,usage_state=:state,"
                     "billable=:billable,reference_cost_pico=:cost,provider_response_id=:receipt,"
                     "returned_model=:model,raw_usage_json=:raw,overrun_cost_pico=:overrun,"
                     "failure_code=:failure,updated_at=:now WHERE attempt_id=:id"),
                {
                    "outcome": outcome, "state": "known" if valid else "unknown",
                    "billable": int(billable),
                    "cost": cost, "receipt": receipt if valid and not duplicate else None,
                    "model": "tavily:basic" if valid else None,
                    "raw": (json.dumps({"credits": credits, "request_id": receipt})
                            if valid else "{}"),
                    "overrun": max(0, (cost or 0) - row["reserved_cost_pico"]),
                    "failure": failure_code, "now": self._now(), "id": attempt_id,
                },
            )
            self._settle_actual(conn, row["run_id"], receipt_attempt_id=attempt_id)
        if duplicate:
            raise BillingReplayBlocked("Tavily receipt was already recorded")
        if exceeded:
            raise BillingBudgetExceeded("Tavily usage exceeded its request reservation")

    def assert_usage_contract(self, attempt_id, raw):
        from collections.abc import Mapping

        from qunxue_api.adapters.model.token_usage import UnknownTokenUsage

        if hasattr(raw, "model_dump"):
            raw = raw.model_dump(exclude_none=True)
        if not isinstance(raw, Mapping):
            raise UnknownTokenUsage("missing provider usage")
        with self.engine.connect() as conn:
            row = self._one(
                conn, "SELECT * FROM billing_attempts WHERE attempt_id=:id", id=attempt_id
            )
        book = self._book(row["price_json"])
        model = book.aliases.get(row["requested_model"], row["requested_model"])
        if model == "deepseek-flash":
            if "prompt_cache_hit_tokens" not in raw or "prompt_cache_miss_tokens" not in raw:
                raise UnknownTokenUsage("DeepSeek cache partition is missing")
            return
        details = raw.get("prompt_tokens_details", raw.get("input_tokens_details", {}))
        if not isinstance(details, Mapping):
            raise UnknownTokenUsage("invalid provider input details")
        present = "cached_tokens" in details and (
            "cache_write_tokens" in details or "cache_creation_input_tokens" in raw
        )
        policy_key = f"{row['provider_host']}:{row['requested_model']}"
        if not present and book.usage_policies.get(policy_key) != "omitted_cache_subsets_are_zero":
            raise UnknownTokenUsage(
                "chargeable cache subtypes need counters or explicit zero-omission policy"
            )

    def complete_attempt(
        self,
        *,
        attempt_id,
        usage_known=True,
        input_tokens=None,
        output_tokens=None,
        cache_read_tokens=0,
        cache_write_tokens=0,
        returned_model=None,
        provider_response_id=None,
        outcome="error",
        failure_code=None,
        reasoning_tokens=None,
        raw_usage_json=None,
        finish_reason=None,
        returned_service_tier=None,
        reconciliation_receipt=None,
        defer_settlement=False,
    ):
        exceeded = False
        mismatch = False
        price_error = None
        with self._transaction() as conn:
            row = self._one(
                conn, "SELECT * FROM billing_attempts WHERE attempt_id=:id", id=attempt_id
            )
            if row is None:
                raise BillingReplayBlocked("attempt is missing")
            operation = self._one(
                conn, "SELECT * FROM billing_operations WHERE run_id=:run", run=row["run_id"]
            )
            if reconciliation_receipt is not None:
                provider_host, provider_request_id = reconciliation_receipt
                if (
                    not provider_request_id or row["provider_host"] != provider_host
                    or row["provider_request_id"] != provider_request_id
                    or row["dispatch_state"] == "not_sent"
                    or row["api_type"] not in {"chat_completions", "responses"}
                ):
                    raise BillingReplayBlocked("receipt does not identify the persisted attempt")
                duplicates = conn.scalar(text(
                    "SELECT count(*) FROM billing_attempts "
                    "WHERE provider_host=:host AND provider_request_id=:receipt"
                ), {"host": provider_host, "receipt": provider_request_id})
                book = self._book(row["price_json"])
                if (
                    duplicates != 1 or not isinstance(returned_model, str) or not returned_model
                    or book.aliases.get(returned_model, returned_model)
                    != book.aliases.get(row["requested_model"], row["requested_model"])
                ):
                    raise BillingReplayBlocked("receipt identity is ambiguous or mismatched")
                if operation is None or operation["status"] == "active":
                    raise BillingReplayBlocked("active delivery owns its own settlement")
                returned_service_tier = row["returned_service_tier"]
            if row["usage_state"] == "known":
                return "already_known" if reconciliation_receipt is not None else None
            if row["usage_state"] == "not_sent":
                return
            cost = None
            if usage_known and input_tokens is not None and output_tokens is not None:
                book = self._book(row["price_json"])
                mismatch = bool(
                    returned_model
                    and book.aliases.get(returned_model, returned_model)
                    != book.aliases.get(row["requested_model"], row["requested_model"])
                )
                # The returned identity, including aliases, must have an explicit tariff.
                try:
                    if not returned_model:
                        raise UnknownPrice("returned provider model identity is missing")
                    if returned_service_tier not in {None, "default", "standard"}:
                        raise UnknownPrice("returned service tier has no configured tariff")
                    cost = book.cost_pico_usd(
                        returned_model or row["requested_model"],
                        input_tokens,
                        output_tokens,
                        cache_read_tokens,
                        cache_write_tokens,
                    )
                except UnknownPrice as error:
                    price_error = error
                    outcome = "error"
                    failure_code = "unknown_returned_price"
                exceeded = not self._independent_delivery(operation) and (
                    (cost is not None and cost > row["reserved_cost_pico"])
                    or input_tokens > row["input_limit"]
                    or output_tokens > row["output_limit"]
                )
                if exceeded:
                    outcome = "overrun"
                elif mismatch:
                    outcome = "model_mismatch"
            billable = int(outcome == "success" and operation["status"] == "active")
            if self._actual_usage(operation):
                billable = int(cost is not None and not mismatch and not exceeded
                               and operation["status"] == "active")
            if self._independent_delivery(operation):
                billable = int(cost is not None and not mismatch)
            if reconciliation_receipt is not None:
                # Authoritative provider cost repairs operator risk only. A later
                # receipt cannot turn failed delivery into success or a charge.
                outcome = row["outcome"]
                if not self._independent_delivery(operation):
                    billable = 0
                failure_code = row["failure_code"]
                provider_response_id = row["provider_response_id"]
                reasoning_tokens = row["reasoning_tokens"]
                finish_reason = row["finish_reason"]
                returned_service_tier = row["returned_service_tier"]
            conn.execute(
                text(
                    "UPDATE billing_attempts SET "
                    "billable=:billable,outcome=:outcome,usage_state=:state,"
                    "dispatch_state=CASE WHEN :state='known' THEN 'usage_confirmed' "
                    "ELSE dispatch_state END,"
                    "input_tokens=:i,output_tokens=:o,cache_read_tokens=:c,cache_write_tokens=:w,"
                    "reference_cost_pico=:cost,returned_model=:model,provider_response_id=:receipt,"
                    "reasoning_tokens=:reasoning,raw_usage_json=:raw,finish_reason=:finish,"
                    "returned_service_tier=:tier,"
                    "overrun_cost_pico=:overrun,failure_code=:failure,updated_at=:now "
                    "WHERE attempt_id=:id"
                ),
                {
                    "outcome": outcome,
                    "billable": billable,
                    "state": "known"
                    if cost is not None
                    else "unpriced"
                    if price_error
                    else "unknown",
                    "i": input_tokens,
                    "o": output_tokens,
                    "c": cache_read_tokens,
                    "w": cache_write_tokens,
                    "cost": cost,
                    "model": returned_model,
                    "receipt": provider_response_id,
                    "failure": failure_code,
                    "reasoning": reasoning_tokens,
                    "raw": raw_usage_json,
                    "finish": finish_reason,
                    "tier": returned_service_tier,
                    "overrun": max(0, (cost or 0) - row["reserved_cost_pico"]),
                    "now": self._now(),
                    "id": attempt_id,
                },
            )
            if self._independent_delivery(operation) and (
                operation["status"] != "active" or defer_settlement
            ):
                confirmed = conn.execute(text(
                    "SELECT * FROM billing_attempts WHERE run_id=:run AND billable=1"
                ), {"run": row["run_id"]}).mappings().all()
                gross = sum(self._attempt_credit(a) for a in confirmed)
                conn.execute(text(
                    "UPDATE billing_operations SET original_credit_pico=:gross WHERE run_id=:run"
                ), {"gross": str(gross), "run": row["run_id"]})
            elif reconciliation_receipt is None:
                self._settle_actual(conn, row["run_id"], receipt_attempt_id=attempt_id)
        if price_error and not self._independent_delivery(operation):
            raise price_error
        if reconciliation_receipt is not None:
            return "reconciled"
        if mismatch and not self._independent_delivery(operation):
            raise BillingRouteMismatch("returned model differs from the locked route")
        if exceeded:
            raise BillingBudgetExceeded("provider usage exceeded its request reservation")

    def mark_attempt_error(self, attempt_id, failure_code):
        with self._transaction() as conn:
            conn.execute(
                text(
                    "UPDATE billing_attempts SET outcome='error',billable=CASE WHEN "
                    "json_extract((SELECT price_json FROM billing_operations o "
                    "WHERE o.run_id=billing_attempts.run_id),'$.billing_policy') "
                    "IN ('actual_usage_v1','actual_usage_v2') "
                    "THEN billable ELSE 0 END,failure_code=:code "
                    "WHERE attempt_id=:id AND outcome='success'"
                ),
                {"id": attempt_id, "code": failure_code},
            )

    def _ledger(self, conn, run, points, *, refund=False, credit_numerator=0,
                receipt_attempt_id=None):
        epoch = run.get("quota_period_epoch")
        period = get_quota_period(conn, run["user_id"], epoch) if epoch is not None else None
        balance = period["balance"] if period else conn.scalar(
            text("SELECT balance FROM credit_accounts WHERE user_id=:user"),
            {"user": run["user_id"]})
        ident = (
            str(uuid5(NAMESPACE_URL, "billing-refund:" + run["run_id"]))
            if refund
            else run["run_id"]
        )
        if not refund and self._one(
            conn, "SELECT entry_id FROM credit_ledger WHERE entry_id=:id", id=ident
        ):
            ident = str(uuid5(NAMESPACE_URL, f"billing-stage:{run['run_id']}:{credit_numerator}"))
        totals = self._one(
            conn,
            "SELECT coalesce(sum(input_tokens),0) AS i, "
            "coalesce(sum(output_tokens),0) AS o FROM billing_attempts WHERE run_id=:run "
            + ("AND billable=1" if self._actual_usage(run) else "AND outcome='success'"),
            run=run["run_id"],
        )
        if receipt_attempt_id is not None:
            totals = self._one(conn,
                               "SELECT coalesce(input_tokens,0) AS i, "
                               "coalesce(output_tokens,0) AS o FROM billing_attempts "
                               "WHERE attempt_id=:id AND run_id=:run",
                               id=receipt_attempt_id, run=run["run_id"])
        conn.execute(
            text(
                "INSERT INTO credit_ledger "
                "(entry_id,user_id,run_id,kind,points,balance_after,input_tokens,output"
                "_tokens,model,created_at) "
                "VALUES (:id,:user,:id,'usage',:points,:balance,:i,:o,:model,:now)"
            ),
            {
                "id": ident,
                "user": run["user_id"],
                "points": points,
                "balance": balance,
                "i": 0 if refund else totals["i"],
                "o": 0 if refund else totals["o"],
                "model": "billing-refund" if refund else "priced-attempts",
                "now": self._now(),
            },
        )
        if epoch is not None:
            conn.execute(text("UPDATE credit_ledger SET quota_period_epoch=:epoch "
                              "WHERE entry_id=:id"), {"epoch": epoch, "id": ident})

    def finish(self, *, run_id, outcome, connection=None):
        if outcome not in {"success", "paused", "error", "cancelled"}:
            raise ValueError("invalid billing operation outcome")
        # A supplied connection belongs to the existing business transaction.
        # Never begin/commit a separate financial transaction in that case.
        with (nullcontext(connection) if connection is not None else self._transaction()) as conn:
            run = self._one(
                conn, "SELECT * FROM billing_operations WHERE run_id=:run", run=str(run_id)
            )
            if run is None or run["status"] in {"error", "cancelled", "refunded"}:
                return run["status"] if run else None
            if run["status"] == outcome and outcome in {"success", "paused"}:
                return run["status"]
            if self._actual_usage(run):
                # Receipt settlement is independent of business delivery. Failure
                # and cancellation close the scope but cannot refund paid usage.
                self._settle_actual(conn, str(run_id))
                attempts = conn.execute(text(
                    "SELECT outcome,usage_state FROM billing_attempts WHERE run_id=:run"
                ), {"run": str(run_id)}).mappings().all()
                if not self._independent_delivery(run) and outcome in {"success", "paused"} and any(
                    a["outcome"] in {
                        "in_flight", "overrun", "model_mismatch", "limited", "rejected"
                    }
                    or (a["outcome"] == "success" and a["usage_state"] != "known")
                    for a in attempts
                ):
                    outcome = "error"
                if (not self._independent_delivery(run)
                    and outcome in {"success", "paused"} and attempts and not any(
                    a["outcome"] == "success" and a["usage_state"] == "known" for a in attempts
                )):
                    outcome = "error"
                conn.execute(text(
                    "UPDATE billing_operations SET status=:status,hold_points=0,updated_at=:now "
                    "WHERE run_id=:run"
                ), {"status": outcome, "run": str(run_id), "now": self._now()})
                return outcome
            attempts = conn.execute(
                text("SELECT * FROM billing_attempts WHERE run_id=:run"), {"run": str(run_id)}
            ).mappings().all()
            delivered = outcome in {"success", "paused"}
            if delivered and any(
                a["outcome"] in {"in_flight", "overrun", "model_mismatch", "limited", "rejected"}
                or (a["outcome"] == "success" and a["usage_state"] != "known")
                for a in attempts
            ):
                outcome, delivered = "error", False
            if delivered and attempts and not any(a["billable"] for a in attempts):
                outcome, delivered = "error", False
            numerator = sum(
                self._attempt_credit(a)
                for a in attempts if a["outcome"] == "success" and a["billable"]
            ) if delivered else 0
            epoch = run.get("quota_period_epoch")
            period = get_quota_period(conn, run["user_id"], epoch) if epoch is not None else None
            if epoch is not None and period is None:
                raise BillingReplayBlocked("operation quota period is missing")
            previous = period or self._one(
                conn, "SELECT total_credit_pico FROM billing_precision WHERE user_id=:user",
                user=run["user_id"],
            )
            previous_total = Fraction(previous["total_credit_pico"]) if previous else 0
            old_exact = Fraction(run["credit_pico"])
            new_total = previous_total
            charged = run["charged_points"]
            if not run["exempt"]:
                account = period or self._one(
                    conn, "SELECT balance FROM credit_accounts WHERE user_id=:user",
                    user=run["user_id"],
                )
                new_total = previous_total - old_exact + numerator
                # Integer rounding belongs to the account's shared exact total.
                # Removing a run also removes its fraction: refund the signed
                # change in that total's floor, not this run's historical debit.
                # Other runs/phases may have consumed its fractional carry.
                points = new_total // PICO_USD - previous_total // PICO_USD
                if delivered and (
                    points < 0 or points > run["hold_points"] or points > account["balance"]
                ):
                    outcome, delivered = "error", False
                    numerator = 0
                    new_total = previous_total - old_exact
                    points = new_total // PICO_USD - previous_total // PICO_USD
                if new_total != previous_total:
                    if period:
                        settle_quota_period(
                            conn, run["user_id"], epoch,
                            account["balance"] - points, str(new_total), self.clock()
                        )
                    else:
                        conn.execute(
                            text("INSERT INTO billing_precision(user_id,total_credit_pico) "
                                 "VALUES (:user,:total) ON CONFLICT(user_id) DO UPDATE SET "
                                 "total_credit_pico=excluded.total_credit_pico"),
                            {"user": run["user_id"], "total": str(new_total)},
                        )
                # Record a zero-point fractional withdrawal as well; the stable
                # refund receipt and terminal status make repeated refunds no-ops.
                if points or numerator != old_exact:
                    if not period:
                        conn.execute(
                            text("UPDATE credit_accounts SET balance=balance+:change,"
                                 "updated_at=:now WHERE user_id=:user"),
                            {"change": -points, "user": run["user_id"], "now": self._now()},
                        )
                    self._ledger(conn, run, -points, refund=not delivered,
                                 credit_numerator=numerator)
                charged = charged + points if delivered else 0
            status = "refunded" if not delivered and old_exact else outcome
            conn.execute(
                text("UPDATE billing_operations SET status=:status,hold_points=0,"
                     "credit_pico=:exact,original_credit_pico=CASE WHEN original_credit_pico='0' "
                     "THEN :exact ELSE original_credit_pico END,charged_points=:points,"
                     "updated_at=:now WHERE run_id=:run"),
                {"status": status, "exact": str(numerator), "points": charged,
                 "now": self._now(), "run": str(run_id)},
            )
            return status

    def recover_stale(self, *, before, recover_actual_usage=False):
        with self.engine.connect() as conn:
            ids = conn.scalars(
                text(
                    "SELECT run_id FROM billing_operations WHERE status='active' "
                    "AND (updated_at < :before OR (:recover_actual AND "
                    "json_extract(price_json,'$.billing_policy') "
                    "IN ('actual_usage_v1','actual_usage_v2')))"
                ),
                {"before": before.isoformat(), "recover_actual": recover_actual_usage},
            ).all()
        for run_id in ids:
            self.finish(run_id=run_id, outcome="error")
