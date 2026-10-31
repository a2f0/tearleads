# API network failures

Every request to the Tearleads API goes through
[`packages/api-client`](../../packages/api-client/src/apiRequestRuntime.ts):
JSON and binary operations, signed-upload and download URLs, and the
server-events WebSocket, which the client SDK opens with
[`openServerEventsSocket`](../../packages/api-client/src/webSocketTickets.ts).
One transport means one place that measures requests, renews sessions, and
explains failures.

## What a failed fetch reports

When `fetch` itself throws, no response arrived. Browsers give JavaScript only
a `TypeError` ("Failed to fetch", "NetworkError when attempting to fetch
resource.", "Load failed"), whatever the cause. The transport turns that into
an [`ApiNetworkError`](../../packages/api-client/src/networkFailure.ts) on the
request failure's `networkError` field, with:

- method and operation path template (never the concrete path or query);
- API origin, page origin, and whether they differ;
- whether the call needs a CORS preflight (non-simple method or headers);
- attempt number (2 is the retry after a session renewal) and elapsed time;
- connectivity: the host's authoritative source when one governs it (the
  native Capacitor source, since Android WebViews misreport
  `navigator.onLine`), otherwise `navigator.onLine`;
- the runtime's error name and message, and its cause's, with any URL cut to
  origin and path.

It never holds headers, tokens, bodies, or query values.

## Classifications

After a failure that is neither a cancellation nor offline, the transport runs
one follow-up probe, a `no-cors` GET of the API origin's root with no
credentials, headers, or body, created by
[`createApiReachabilityProbe`](../../packages/api-client/src/apiReachabilityProbe.ts).
One probe per origin runs at a time and its result answers every failure for
15 seconds, so a burst of failed calls costs one probe; it times out after 3
seconds, and a caller abort ends the wait and the request as a cancellation.
Shells enable it with the host option `probeApiNetworkFailures`
(`TearleadsOptions.probeApiNetworkFailures`); tests leave it off.

| Classification    | Meaning                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| `offline`         | The device reports no network.                                         |
| `api-unreachable` | The probe failed too: DNS, TLS, connection, or a blocked host.         |
| `cors-or-blocked` | The host answered the probe; this call hit CORS, a rule, or a drop.    |
| `timeout`         | A `TimeoutError` (the caller's signal or the runtime) ended it.        |
| `aborted`         | The caller or runtime aborted it.                                      |
| `unclassified`    | No probe ran.                                                          |

The System Monitor log line keeps the browser's message and adds the
classification and a hint, for example:

```text
POST /auth/register: Failed to fetch (api-unreachable: API host unreachable
from this browser: check DNS, extensions/shields, or network; open
https://api.tearleads.com/ in a tab)
```

Plain cancellations and unclassified failures keep the old message.

## Limits

JavaScript cannot read the browser's network error code. A stale DNS cache
entry (`net::ERR_NAME_NOT_RESOLVED`), an extension or shield
(`net::ERR_BLOCKED_BY_CLIENT`), a TLS failure, and a refused connection all
read as `api-unreachable`; only the browser's console or network panel names
the cause. A `cors-or-blocked` failure can also be a connection that dropped
after the probe succeeded. `navigator.onLine` can be true without a working
network, which then reads as `api-unreachable`. No same-origin probe runs, and
an API on the page's own origin is not probed: the web app's service worker can
answer same-origin requests from cache, so neither would prove the host or this
device is reachable. Those failures stay `unclassified`.

The structured details stay on the failure for host diagnostics. Browser
Sentry events still carry only the allowlisted fields in
[private error diagnostics](sentry.md); adding these fields there needs its
own privacy review.

## Network use outside the API client

`bun run lint:architecture` fails when client-side packages (app, client SDK,
the shells, diagnostics, sqlite-worker, ui, website, windowing) use `fetch`,
`XMLHttpRequest`, `WebSocket`, `EventSource`, or `sendBeacon` directly. The
check lives in
[`scripts/architecture/apiTransport.ts`](../../scripts/architecture/apiTransport.ts),
which lists the files that legitimately use the network for something other
than the API, each with its reason:

- Sentry envelopes and the packaged `sentry-assets.json`
  ([`packages/diagnostics`](../../packages/diagnostics/));
- the Capacitor scanner reading a captured photo from a local file URL;
- the Electrobun download bridge to its local Bun host, and that host's own
  request handlers;
- sqlite-worker's `file:` wasm loads under Bun;
- the website's same-origin screenshot manifest and installer metadata from
  the downloads bucket.

Third-party SDKs (Stripe.js, Sentry's browser transport) make their own
requests inside their packages. Signed blob URLs point at object storage, but
the API client still makes those requests.
