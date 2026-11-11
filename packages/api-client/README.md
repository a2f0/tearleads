# @tearleads/api-client

The typed HTTP client for the Tearleads API. Every request a client makes goes
through it: JSON and binary operations, signed upload and download URLs, and
the server-events WebSocket. The [client SDK](../client-sdk/README.md) builds
on it; the API's own tests and `@tearleads/test-utils` use it to drive the
server the way a client would.

Requests and responses are checked against the operation contracts in
[`@tearleads/validators`](../validators/README.md), so the client and the
API share one wire shape. The client may share crypto and validator
contracts, but must not import server, app, SDK, UI, or deployment code.

## Entry points

| Entry point | Use for |
| --- | --- |
| `@tearleads/api-client` | `ApiClient`, network failure types, the reachability probe, request metrics, and `openServerEventsSocket` |
| `@tearleads/api-client/ApiClient` | The `ApiClient` class alone |
| `@tearleads/api-client/types` | Request result, failure, and method types |

## Layout

`ApiClient` publishes each method as an instance property, so methods stay
bound when passed around. Each method is implemented by one request area
under [`src/client`](src/client/) (session, identities, principal policies,
organizations,
containers, documents, blobs, writer projections, billing, and root admin),
and each area calls the route helpers under [`src/routes`](src/routes/). One
transport
([`src/apiRequestRuntime.ts`](src/apiRequestRuntime.ts)) measures requests,
renews sessions, and explains
failures.

- [API network failures](../../docs/developer/api-network-failures.md)
  describes what a failed request reports and how reachability is probed.
- [API request cost](../../docs/developer/api-request-cost.md) covers the
  request metrics and server timing.

## Organization creation results

`createOrganizationResult(request)` preserves the validated `RequestResult`
(including failure status and registered code). `createOrganization(request)`
continues to return the successful response or `null`.

Only HTTP 410 with `code: "organization_creation_purged"` certifies that an
ordinary create committed and its organization was irreversibly purged. The
server validates the current signer, authenticated user and exact request hash
before issuing it. The SDK releases that exact pending attempt under its
identity guard and returns `null`; only a later deliberate invocation may mint
fresh artifacts. Disabled membership, scheduled deletion, generic 4xx,
malformed bodies and transport failures retain the pending attempt.

Purge removes the retained ordinary bootstrap response along with remote data,
not its user/hash binding. That binding suffices for terminal certification;
registration, replacement and native-restore protocols are unchanged.

## Tests

```sh
bun run --cwd packages/api-client test
```
