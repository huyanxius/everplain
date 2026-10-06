# Bookmark fetch connection boundary

## Scope and evidence

This changes only the background bookmark importer (`fetch_bookmark`). It is a
small outbound-network boundary extraction, not an application-wide network
rewrite. The research agent's separate `web_research.py` / `urllib` fetch path is
not covered; adapting that caller needs its own behavior and compatibility tests.

On baseline `72f4b6d0`, `public_url()` checked a hostname's DNS answer, then HTTPX
resolved the original hostname again when connecting. A controlled, no-network
fixture returned a public address for the first lookup and loopback for the
second; the fake socket received loopback and the importer accepted its response.
This proves a check/dial gap, not exploitation or a production incident.

## Invariant and implementation

`PublicNetworkBackend` resolves the hostname at the connection boundary, rejects
an empty answer or any non-global address in the complete answer, and passes only
canonical numeric addresses to the standard HTTPcore socket backend. Hostname DNS
changes cannot replace those numeric destinations. Public A/AAAA answers retain
resolver order and connection-failure fallback, sharing one TCP connect budget.
The system DNS resolver itself is synchronous and is not forcibly interrupted by
that budget; the old implementation had the same resolver limitation.

`PublicHTTPTransport` uses the public HTTPX transport and HTTPcore network-backend
APIs. It does not rewrite the request origin or patch library internals. Therefore
Host, TLS SNI, hostname verification, trust roots and origin-keyed connection
pooling retain their normal behavior. TLS verification remains required.
`SSL_CERT_FILE` / `SSL_CERT_DIR` still use HTTPX's normal SSL-context creation.
HTTPcore is now an explicit dependency at the already-locked version; no package
version changes are required.

Every redirect passes the URL and route policy again. Every newly opened
connection resolves and validates its target, including reconnects to the same
hostname. Reusing an already-validated live connection does not require another
DNS lookup: DNS changes cannot move that existing socket. Protocol, credentials,
port, redirect-count, response-size and media-type restrictions remain in place.
The legacy `public_url()` validator is retained, but is not itself a secure fetch
primitive and must not be used as a substitute for the transport boundary.

## Explicit proxy compatibility change

A generic environment proxy can resolve the original hostname elsewhere, outside
this address constraint. Bookmark fetching now fails closed with the classified
`proxy_unsupported` error when the URL would use `HTTP_PROXY`, `HTTPS_PROXY` or
`ALL_PROXY`. It does not connect to that proxy or silently bypass an operator's
proxy by dialing directly. The error suggests collecting the already-open page
with the browser extension and never includes proxy credentials or addresses.

HTTPX-compatible `NO_PROXY` routes continue to use the constrained direct path.
In particular `.example.org` matches subdomains only, `example.org` also matches
the apex, IP literals are exact matches, and scheme/port-qualified entries and
`*` retain the existing routing semantics. A bypass entry never bypasses the
public-address check. Proxy selection is checked on each redirect, too.

The public Compose and deployment source does not configure an outbound proxy,
but Compose loads an operator-controlled environment file. This is **not evidence
that production has no proxy**. Before deployment, the operator/release owner
must confirm whether the API runtime needs a proxy for bookmark URLs, without
publishing credentials or private environment values. If it does, do not deploy
this candidate until a separate constrained-proxy solution has been designed and
verified. Do not remove a required proxy or change network settings to make this
candidate pass. No production configuration is changed by this patch.

## Benefits, costs and verification

- Eliminates the demonstrated hostname check/dial race in this import path.
- For a new single-hop connection, hostname resolution calls fall from two to
  one. The standard backend may still call `getaddrinfo` for the numeric literal;
  that is not another hostname DNS lookup. No live-network latency claim is made.
- Adds a small, separately tested HTTPX/HTTPcore adapter and its explicit version
  dependency. Avoids a new proxy service, global socket monkeypatch, custom TLS
  implementation, DNS cache, cross-product network platform or production change.
- Effective environment proxy routes deliberately stop fetching until their
  connection constraints are supported; this is a release compatibility gate.
- Does not prove or configure OS/firewall egress restrictions, nor protect other
  fetchers. Defense at the infrastructure layer remains outside this change.

Tests use synthetic DNS, fake sockets and locally generated TLS certificates;
they do not dial public websites, internal services or a production network.
`test_bookmark_public_transport.py` exercises the real HTTPX/HTTPcore stack,
including address binding, mixed-family rejection, fallback, redirects, timeouts,
body limits, proxy routing, exception classification and resource closure.
`test_bookmark_tls_boundary.py` performs real OpenSSL MemoryBIO handshakes for
matching, mismatching and untrusted certificates, preserving Host/SNI and the
configured trust file. It generates temporary test keys/certificates with the
OpenSSL CLI available on the existing Ubuntu CI runner; no key is checked in.
Both tests are included in the existing backend product suite. Import parser,
owner-isolation, incremental import and migration regressions remain applicable.

Public extension contracts: [HTTPcore network backends](https://www.encode.io/httpcore/network-backends/),
[HTTPX custom transports](https://www.python-httpx.org/advanced/transports/), and
[HTTPX environment variables](https://www.python-httpx.org/environment_variables/).
