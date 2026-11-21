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

## Entry point

`@tearleads/api-client` is the only entry point. It exports the transport
surface: `ApiClient`, request results and failures, the options and ports its
methods take, the reachability probe, request metrics, and
`openServerEventsSocket`. It does not re-export wire or protocol types:
import those, such as `PrincipalPolicyPageCurrent` or the held writer
projection citation types, from `@tearleads/validators/response`. The
`api-client-exports-only-transport-surface` check in
`bun run lint:architecture` holds the export list to
[`apiClientRootExports`](../../scripts/architecture/apiClientSurface.ts).

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

- [`src/policyHistoryPageChecks.ts`](src/policyHistoryPageChecks.ts) holds
  the pure checks that decide whether a principal policy or projection
  history page continues its cursor chain; the pagers call them per page.
- Writer projection reads cite held bytes prepared by `@tearleads/crypto`'s
  `prepareHeldProjectionCitations`, within the
  [citation deadline](src/verifiedManifestCitations.ts).
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
