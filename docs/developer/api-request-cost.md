# API request cost

Every API response carries a `Server-Timing` header, exposed to cross-origin
clients through CORS. CORS preflights and refusals the Worker issues before
the app runs are the exceptions.

```text
Server-Timing: total;dur=182.4, db;dur=171.9
```

The deployed Workers also log one JSON line per request, because
[`packages/api/wrangler.jsonc`](../../packages/api/wrangler.jsonc) sets
`API_REQUEST_COST_LOG=true` for staging and production. Tests and local servers
stay quiet unless that variable is set.

```json
{"event":"api.request.cost","method":"POST","route":"/documents/{documentId}/sync","status":200,"statements":44,"wallMs":182.4,"dbMs":171.9}
```

| Field        | Meaning                                                   |
| ------------ | --------------------------------------------------------- |
| `event`      | Always `api.request.cost`; filter on it.                  |
| `method`     | HTTP method.                                              |
| `route`      | Matched route template, or `unmatched`.                   |
| `status`     | Response status, including error-handler responses.       |
| `statements` | ORM statements executed, including transaction controls.  |
| `wallMs`     | Time from after CORS until the handler returned.          |
| `dbMs`       | Time spent in database driver calls.                      |

The middleware lives in [`packages/api/src/diagnostics/requestCost.ts`](../../packages/api/src/diagnostics/requestCost.ts).

## What the numbers mean

- [Worker clocks advance only after I/O](https://developers.cloudflare.com/workers/runtime-apis/performance/),
  so a synchronous CPU-only span can read as zero. These are elapsed clock
  readings, not I/O-only counters: an interval ending on I/O can include CPU
  since the previous clock update. Read CPU from the invocation record for
  the same request in Workers Logs. The measurements overlap; subtracting CPU
  from `dbMs` does not yield network time.
- `dbMs` sums every driver call, including acquiring a connection. A
  request-scoped Worker connection opens on its first query, so that query
  includes the Hyperdrive handshake. Concurrent queries can make `dbMs`
  exceed `wallMs`.
- A large `wallMs` with a small `dbMs` points outside the instrumented database
  calls. A large `dbMs` with many `statements` makes serial round trips a useful
  hypothesis, but count alone cannot exclude expensive queries, lock waits,
  or scheduling delays. Use query timings and plans to distinguish them.
- `wallMs` stops when the handler and read-model hint verification return.
  It excludes the Worker's body admission queue, response body streaming, and
  `waitUntil` work after the response.

## Privacy

The log names the route template, never the URL, so no container, document,
or other identifier reaches it. It retains no SQL text, parameters, user, or
session. The header carries durations only: a statement count on a refused
request could tell a client whether a resource it cannot read exists. Nothing
here is sent to Sentry; see [private error diagnostics](sentry.md).

## Reading the log

In the Cloudflare dashboard, open the API Worker's Observability tab
(`tearleads-platform-api-prod` or `tearleads-platform-api-staging`), filter on
`event` equal to `api.request.cost`, and group by `route`. Workers Logs indexes
the fields of JSON log lines, so averages and percentiles of `wallMs`, `dbMs`,
and `statements` are available per route. For a live view, run
`bunx wrangler tail tearleads-platform-api-prod --format json` from
[`packages/api`](../../packages/api/).

In a browser, the DevTools Network panel shows the header under each request's
Timing tab, which separates server time from network time.

For repeatable fresh-account experiments, use the
[performance harness](../../packages/performance/README.md). It exercises the
public SDK against an explicitly selected tier and can correlate individual
requests with these Cloudflare cost logs.

The [database round-trip probe](../../packages/performance/database-experiment.md)
separates connection acquisition, warm driver calls, and constant-query server
execution using the same PostgreSQL transport and Hyperdrive binding. It runs
in a temporary Worker whose persisted placement must match the live API.

The [registration artifact batching experiment](registration-artifact-batch.md)
records a staging baseline/candidate/restored-baseline comparison, including
the measured statement reduction and limits on attributing latency changes.
