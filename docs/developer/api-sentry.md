# API error diagnostics

The API captures unexpected HTTP errors (500+, including temporary database
failures) and failures during WebSocket handshakes. A domain error carrying a
500+ status answers with its own status and body, which the shared handler
never sees, so it is captured where it is answered instead. Its status is kept
deliberately: propagating it would turn a retryable 503 into a permanent 500
unless its cause chain happened to look like driver contention. Expected client
errors and organization entitlement failures keep their usual responses and
stay local. Each captured API error has an independent scope and no
breadcrumbs, preventing activity from different requests from mixing.

Both API tiers use `privacy=api-allowlist-v3`. Reports carry `api_operation`
(for example, `websocket.revalidate` or `billing.seat-sync`), with a reviewed
`api_error_code`, `api_cause_type`, and `api_error_status` when recognized.
Classification inspects at most five errors in a cause chain. It reads data
properties without invoking getters, and never exports SQL, connection
addresses, request URLs, entity IDs, or raw error text. The vocabulary lives in
[`packages/diagnostics/src/apiVocabulary.ts`](../../packages/diagnostics/src/apiVocabulary.ts);
additions need review.

HTTP failures also carry `api_method`, `api_response_status`, and `api_route`.
Routes must match the OpenAPI templates compiled into the release, such as
`/documents/{documentId}`; request URLs and parameter values never qualify.
The response status records the actual error-handler or domain-error response,
independently of a nested driver's HTTP status.

Postgres acquisition failures carry `api_database_stage=connect`,
`api_connection_attempts`, and `api_pool_total`, `api_pool_idle`, and
`api_pool_waiting`. These bounded integer counters describe that event's pool,
not the database server's global connections. `PG_CONNECT_TIMEOUT` identifies
a timed-out connection handshake; `PG_POOL_TIMEOUT` identifies waiting for a
pool checkout. Other transient connection failures use
`PG_CONNECTION_UNAVAILABLE`; non-retryable failures use `PG_CONNECTION_FAILED`.
Recognized deeper driver codes, such as `28P01`, remain available.

The pool retries a transient acquisition failure once, before any query or
transaction starts. It never replays SQL or a transaction after acquiring the
client. Each attempt retains the five-second timeout; exhausted transient
acquisitions produce HTTP 503. Authentication and unknown failures are not
retried. A timeout does not by itself establish pool exhaustion: compare the
pool counters and the cause stack before diagnosing the underlying service.

An API title can read **API WebSocket interest revalidation failed: connection
refused (ECONNREFUSED)**. Driver errors often contain only runtime or dependency
frames outside the bundle, which the path allowlist drops. The reporter then uses
an independently captured application stack, filtered through the same
allowlist. `api_stack=capture-site` distinguishes where the error was reported
from the original throw site (`original`); `unavailable` means neither stack
had an approved frame. Up to five exceptions retain their separately sanitized
stacks, ordered from cause to enclosing error, with up to forty frames each.
Cause messages, frame variables, source text, and unapproved paths remain
excluded. Cycles are bounded. Custom `stack` accessors are rejected. V8's native
lazy-stack accessor is admitted by its captured function identity; runtime
formatting may consult `name`, `message`, or `Error.prepareStackTrace`, and the
result still passes the frame allowlist.
Cron maintenance runs in the same admitted bundle.
This preserves diagnostic locations without enabling automatic integrations.
The transport validates the vocabulary again. None of these API fields apply
to client and desktop collection (`privacy=allowlist-v2`), whose only
server-derived field is the API build number the client last heard from
(`api_version`).

The hourly deduplication includes these safe fields and locations, so unrelated
operations or recognized error codes do not collapse into one frameless error.
Pool counters are retained on the event but excluded from its deduplication key,
so changing queue depth cannot exhaust the budget for unrelated failures.
The five-per-minute and twenty-per-hour budgets apply per diagnostics instance
(a Worker isolate), not across the service. Event counts are bounded samples.
The API transport aggregates locally suppressed events into Sentry client
reports, at most once per minute when flushed. Their only data is a timestamp,
`category=error`, `reason=sample_rate`, and a quantity. View client-discarded
data in Sentry's usage/data-fidelity view to include those counts. These reports
are best effort: an evicted isolate can lose pending counts. They do not contain
messages, identifiers, routes, or per-event data; the automatic SDK client-report
integration remains disabled.

Failures the API logged and deliberately swallowed — a realtime publish after
the write already committed, read-model notification verification, session
revocation notices, and post-handshake WebSocket interest handling — report
under `diagnostic_source=background-error`, which keeps them out of the
request 5xx signal. They are fire-and-forget: reporting cannot change the
response, and the committed write stays committed. Process and native crashes
remain outside this integration.

The blob-GC and billing maintenance runs, scheduled by the Worker's Cron
Triggers, use the same diagnostics configuration and report their own swallowed
maintenance failures: blob reclamation reports the aggregate carrying every
per-object failure, and each billing phase reports independently so one failure
does not hide the others.
Per-item failures, which the sweeps count and drop rather than raise, report
too; free-trial expiry reports at the attention threshold its backoff already
defines rather than on every retryable attempt. An aggregate reports a bounded
number of its constituents rather than itself, because its own stack is its
construction site and each constituent needs its own cause chain.
Maintenance drains pending reports before its scheduled event completes. HTTP
requests use `waitUntil` to finish reporting after the response. Reporting never
changes the operation's outcome.

See [private error diagnostics](sentry.md) for project configuration,
deployment, collection limits, and verification commands.
Per-request timings and statement counts go to Workers Logs instead of Sentry;
see [API request cost](api-request-cost.md).

Worker builds admit only the deployed entry bundle, `index.js`. workerd exposes
bundle positions to the in-process Sentry client; Cloudflare remaps its own
logs after execution using the uploaded source map. Sentry therefore receives
`app:///index.js` with line and column positions, stripped of function names,
source text, request data, and machine paths. These positions identify the
bundle for that release. The API deployment builds once with Wrangler's dry run,
uploads that bundle and map to Sentry under `tearleads-api@<commit>`, the tier's
`dist`, and `app:///index.js`, then deploys the same bundle with `--no-bundle`.
Cloudflare also receives the map. Missing credentials, artifacts, a dirty
checkout, or an upload failure stop preparation before migrations and publication.
The workerd regression executes the parser and both privacy passes against an
intercepted transport without sending events.
