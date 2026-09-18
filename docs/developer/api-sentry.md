# API error diagnostics

The API captures unexpected HTTP errors (500+, including temporary database
failures) and failures during WebSocket handshakes. A domain error carrying a
500+ status answers with its own status and body, which the shared handler
never sees, so it is captured where it is answered instead. Its status is kept
deliberately: propagating it would turn a retryable 503 into a permanent 500
unless its cause chain happened to look like driver contention. Expected client
errors and organization entitlement failures keep their existing responses and
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
frames, all of which the path allowlist drops. In that case the reporter uses
an independently captured application stack, filtered through the same
allowlist. `api_stack=capture-site` distinguishes where the error was reported
from the original throw site (`original`); `unavailable` means neither stack
had an approved frame. Maintenance entrypoints are explicitly allowlisted too.
This preserves diagnostic locations without enabling automatic integrations.
The transport validates the vocabulary again. Client and desktop reporting
retain `allowlist-v1`; the API additions do not expand their collection policy.

The hourly deduplication includes these safe fields and locations, so unrelated
operations or recognized error codes do not collapse into one frameless error.
The five-per-minute and twenty-per-hour budgets still apply; event counts are
bounded diagnostic samples rather than total failure counts. Existing events
cannot regain information omitted by an older executable; deploy a new API
build to receive the richer reports.

Failures the API logged and deliberately swallowed — a realtime publish after
the write already committed, read-model notification verification, session
revocation notices, and post-handshake WebSocket interest handling — report
under `diagnostic_source=background-error`, which keeps them out of the
request 5xx signal. They are fire-and-forget: reporting cannot change the
response, and the committed write stays committed. Process and native crashes
remain outside this integration.

The blob-GC and Stripe-seat-sync executables build with the same diagnostics
configuration and report their own swallowed maintenance failures: blob
reclamation reports the aggregate carrying every per-object failure, and each
billing phase reports independently so one failure does not hide the others.
Per-item failures, which the sweeps count and drop rather than raise, report
too; free-trial expiry reports at the attention threshold its backoff already
defines rather than on every retryable attempt. An aggregate reports a bounded
number of its constituents rather than itself, because only the first exception
survives sanitizing and the aggregate's own stack is its construction site.
Both binaries drain pending reports before exiting, since a short-lived process
can otherwise finish and exit while a report is still in flight. Reporting never
changes their exit status.

See [private error diagnostics](sentry.md) for project configuration,
deployment, collection limits, and verification commands.
