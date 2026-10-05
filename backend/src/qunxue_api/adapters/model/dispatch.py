"""Content-free, conservative evidence from supported HTTPcore transport events."""

from importlib.metadata import version

import httpx


class DispatchEvidence:
    def __init__(self, runtime, attempt_id, *, supported=False, previous_trace=None):
        self.runtime, self.attempt_id = runtime, attempt_id
        self.supported, self.previous_trace = supported, previous_trace
        self.connect_failed = False
        self.connect_succeeded = False
        self.sent_started = False
        self.response_seen = False
        self.trace_failed = False

    async def trace(self, name, info):
        try:
            if name == "connection.connect_tcp.started":
                self.connect_failed = False
            elif name == "connection.connect_tcp.complete":
                self.connect_succeeded = True
                self.connect_failed = False
            elif name == "connection.connect_tcp.failed":
                self.connect_failed = True
            elif name in {
                "http11.send_request_headers.started",
                "http2.send_request_headers.started",
            }:
                self.sent_started = True
                self.runtime.mark_dispatch_started(self.attempt_id)
            if self.previous_trace is not None:
                await self.previous_trace(name, info)
        except BaseException:
            self.trace_failed = True
            raise

    def record_response(self, response):
        self.response_seen = True
        receipt = response.headers.get("http_x_reqid") or response.headers.get("x-request-id")
        self.runtime.record_response_received(self.attempt_id, receipt)

    def finish_failed(self, error):
        # Absence of trace, cancellation/crash and unsupported/custom transports
        # are all unknown. Only a positive terminal TCP failure before HTTP sends
        # on the selected stock transport proves this invocation was not sent.
        if (
            isinstance(error, Exception)
            and self.supported
            and self.connect_failed
            and not self.connect_succeeded
            and not self.sent_started
            and not self.response_seen
            and not self.trace_failed
        ):
            self.runtime.release_proven_not_sent(self.attempt_id)


def attach_dispatch(request, runtime, attempt_id, client):
    evidence = request.extensions.get("everplain_dispatch")
    if evidence is not None:
        # Redirect/auth paths may reuse extensions; never infer no-send there.
        evidence.supported = False
        return evidence
    transport = client._transport_for_url(request.url)
    evidence = DispatchEvidence(
        runtime,
        attempt_id,
        supported=(type(transport) is httpx.AsyncHTTPTransport
                   and version("httpx") == "0.28.1"
                   and version("httpcore") == "1.0.9"),
        previous_trace=request.extensions.get("trace"),
    )
    request.extensions["everplain_dispatch"] = evidence
    request.extensions["trace"] = evidence.trace
    return evidence


async def response_dispatch_hook(response):
    evidence = response.request.extensions.get("everplain_dispatch")
    if isinstance(evidence, DispatchEvidence):
        evidence.record_response(response)
