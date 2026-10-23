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

Both API tiers use `privacy=api-allowlist-v2`. Reports carry `api_operation`
(for example, `websocket.revalidate` or `billing.seat-sync`), with a reviewed
`api_error_code`, `api_cause_type`, and `api_error_status` when recognized.
Classification inspects at most five errors in a cause chain. It reads data
properties without invoking getters, and never exports SQL, connection
addresses, request URLs, entity IDs, or raw error text. The vocabulary lives
in `packages/diagnostics/src/apiVocabulary.ts`; additions need review.

An API title can read **API WebSocket interest revalidation failed: connection
refused (ECONNREFUSED)**. Driver errors often contain only runtime or dependency
frames outside the bundle, which the path allowlist drops. The reporter then uses
an independently captured application stack, filtered through the same
allowlist. `api_stack=capture-site` distinguishes where the error was reported
from the original throw site (`original`); `unavailable` means neither stack
had an approved frame. Cron maintenance runs in the same admitted bundle.
This preserves diagnostic locations without enabling automatic integrations.
The transport validates the vocabulary again. None of these API fields apply
to client and desktop collection (`privacy=allowlist-v2`), whose only
server-derived field is the API build number the client last heard from
(`api_version`).

The hourly deduplication includes these safe fields and locations, so unrelated
operations or recognized error codes do not collapse into one frameless error.
The five-per-minute and twenty-per-hour budgets apply; event counts are bounded
diagnostic samples rather than total failure counts.

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
number of its constituents rather than itself, because only the first exception
survives sanitizing and the aggregate's own stack is its construction site.
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
bundle for that release; uploading source maps to Cloudflare alone does not
symbolicate Sentry events. The workerd regression executes the parser and both
privacy passes against an intercepted transport without sending events.
