# API Architecture

## Summary

This document defines two related but distinct structures:

- protocol planes describe *what kind of state* we are handling
- API layers describe *where code lives* and *what each part is allowed to do*

Those are related, but they are not the same axis.

For shared protocol terminology, see [glossary.md](./glossary.md).

## Protocol Planes

The protocol has three main planes:

1. document plane
2. attachment plane
3. access plane

These are described in [loro-e2ee-sync-protocol.md](./loro-e2ee-sync-protocol.md).
The cross-package handshake and proof contract is specified in
[protocol-specification.md](./protocol-specification.md).

A single use case can touch more than one plane. For example:

- `shareContainer` is mostly access-plane work
- `createContainer` touches access plane and metadata-document setup
- signed document/blob mutations span document, attachment, and access
 planes

Protocol planes are a domain model, not a source-tree layout rule.

## HTTP Protocol Surface

The executable route and validator shapes are defined by the operation
contracts in `packages/validators/src/operation` and their registrations under
`packages/api/src/routes`; `docs/openapi.json` is generated from them and lists
every route. Documentation treats those sources as the source of truth.

Write surfaces:

| Capability | Route | Validator |
| --- | --- | --- |
| Request auth challenge | `POST /auth/challenge` | `ChallengeRequest` |
| Verify auth challenge | `POST /auth/verify` | `VerifyRequest` |
| Register identity and bootstrap root state | `POST /auth/register` | `RegistrationRequest` |
| Destroy current session | `POST /auth/logout` | n/a |
| Destroy a user session | `DELETE /auth/sessions/:sessionId` | n/a |
| Mint a one-time websocket ticket | `POST /auth/ws-ticket` | n/a |
| Store signed organization policy and member envelopes atomically (group updates use `policy-commit`) | `PUT /principals/organization/:principalId/policy` | `OrganizationPrincipalPolicyRequest` |
| Create an organization | `POST /organizations` | `CreateOrganizationRequest` |
| Update the organization profile | `PUT /organizations/:organizationId/profile` | `UpdateOrganizationProfileRequest` |
| Atomically advance a group policy and its signed organization-directory head | `PUT /organizations/:organizationId/groups/:groupId/policy-commit` | `CommitOrganizationGroupPolicyRequest` |
| Atomically create an organization group and advance its signed directory | `POST /organizations/:organizationId/groups` | `CreateOrganizationGroupWithPolicyRequest` |
| Delete an organization group | `DELETE /organizations/:organizationId/groups/:groupId` | `DeleteOrganizationGroupRequest` |
| Bind encrypted roster profile document | `PUT /organizations/:organizationId/roster/:userId` | `UpdateOrganizationRosterEntryRequest` |
| Create container with metadata document | `POST /containers/with-metadata-document` | `ContainerCreateWithMetadataDocumentRequest` |
| Create container | `POST /containers` | `ContainerMutationRequest` |
| Share container | `POST /containers/:containerId/share` | `ContainerMutationRequest` |
| Revoke container grant | `POST /containers/:containerId/revoke` | `ContainerRotationRequest` |
| Rekey container | `POST /containers/:containerId/rekey` | `ContainerRotationRequest` |
| Move container | `POST /containers/:containerId/move` | `ContainerRotationRequest` |
| Re-cite a held container's current ancestor path | `POST /containers/:containerId/recite` | `ContainerReciteRequest` |
| Delete container | `DELETE /containers/:containerId` | n/a |
| Create document | `POST /documents` | `DocumentCreateRequest` |
| Link document to container | `POST /documents/:documentId/link` | `DocumentLinkSetMutationRequest` |
| Unlink document from container | `POST /documents/:documentId/unlink` | `DocumentLinkSetMutationRequest` |
| Purge a document | `POST /documents/:documentId/purge` | `DocumentPurgeRequest` |
| Sync encrypted Loro updates | `POST /documents/:documentId/sync` | `DocumentSyncRequest` |
| Initiate multipart blob stage (returns the first parts' upload sources) | `POST /blobs/stages/multipart` | `InitiateMultipartBlobStageRequest` |
| Authorize a later or renewed direct multipart blob part | `POST /blobs/stages/multipart/:stageId/parts/:partNumber/upload` | `MultipartBlobPartUploadRequest` |
| Upload multipart blob part for non-signing stores | `PUT /blobs/stages/multipart/:stageId/parts/:partNumber/bytes` | headers plus octet stream |
| Bind or replace blob attachment (completes a staged upload) | `POST /blobs/:blobId/attachment-bindings` | `BlobAttachmentBindRequest` |
| Detach blob attachment | `POST /blobs/:blobId/attachment-bindings/:bindingId/detach` | `BlobAttachmentDetachRequest` |

Read surfaces:

| Capability | Route |
| --- | --- |
| Health check | `GET /` |
| List auth sessions | `GET /auth/sessions` |
| Get complete user identity | `GET /auth/user-identity/:userId` |
| List containers by parent lane | `POST /containers/parent-lanes/query` |
| List container documents by lane | `POST /containers/documents/query` |
| Get container writer projection | `GET /containers/:containerId/writer-projection` |
| Page a container's KEK rotation log | `GET /containers/:containerId/kek-log` |
| Get a re-shared container's replacement lineage | `GET /containers/:containerId/replacement-authorizations/:replacesOrganizationId` |
| Get document writer projection | `GET /documents/:documentId/writer-projection` |
| Get a document purge proof | `GET /documents/:documentId/purge` |
| Get document edit attribution | `GET /documents/:documentId/attribution` |
| List document attribution ranges | `GET /documents/:documentId/attribution/ranges` |
| List active document attachments | `GET /documents/:documentId/attachments` |
| Get a blob download source (API or signed URL) | `GET /blobs/:blobId/download` |
| Get committed blob bytes | `GET /blobs/:blobId/bytes` |
| Get multipart blob stage status | `GET /blobs/stages/multipart/:stageId` |
| Get principal policy bundle | `GET /principals/:principalType/:principalId/policy` |
| Page projection policy history | `GET /principals/history` |
| Page organization policy history | `GET /organizations/:organizationId/policy-history` |
| Get organization data usage | `GET /organizations/:organizationId/data-usage` |
| List organization group members | `GET /organizations/:organizationId/groups/:groupId/members` |
| Reconcile the organization read model | `GET /organizations/:organizationId/read-model` |

The organization directory and group list have no routes of their own; clients
read them from the organization read-model feed.

The document sync request names protocol fields:
`contentKeyEpoch`, `expectedLinkSetManifestHash`, `expectedTargetHash`,
optional `contentKeyBundle`, optional `containerRekeys`, `inlineRekeyCommitId`
exactly when that rekey array is non-empty, optional
`authorizingContainerPathRefs`, `localVersionVector`, optional `minLsn`,
required `supportsPullPagination: true`, optional `pullCursor`, optional
`historyMode: "raw"`, and `outgoingUpdates[]` with a per-update `writeHeader`.
Cursor continuations and raw-history pulls are read-only. The path references
identify signed container manifests already held by the API; the expected
link-set hash pins the server-resolved document manifest.
Responses return `documentId`, `acceptedOutgoingUpdateIds`, `commitLsn`,
`commitLsnMode`, the current-epoch `contentKeyBundle`, the `contentKeyBundles`
array of older epochs that served updates cite (empty for an empty probe or a
page at the current epoch; never a repeat of `contentKeyBundle`),
`documentKekTargets`, `pullPage: {hasMore, nextCursor}`, and encrypted
`updates[]`.

Other route families have their own documents:

- [root-operator-api.md](./root-operator-api.md): the root operator surface
  (internal staff and technical support only), root access, the root audit
  trail, and account suspension.
- [organization-memberships.md](./organization-memberships.md): the
  `/organization-memberships` routes.
- [RevenueCat billing](./developer/revenuecat-billing.md),
  [native stores](./developer/revenuecat-native-stores.md), and
  [Stripe Checkout](./developer/stripe-checkout-client.md): the
  `/organizations/:organizationId/billing/**` routes and the
  `/billing/revenuecat/webhook` and `/billing/stripe/webhook` receivers.

## Code Layers

The API is organized in these layers, enforced by `bun run lint:architecture`.

### 1. Entry Points

These are the top-level process and app bindings.

- `packages/api/src/worker/index.ts`
  - the Cloudflare Workers entry that deployed tiers run
- `packages/api/src/index.ts`
  - the Bun local development server
  - owns the HTTP server binding and websocket upgrade handling
- `packages/api/src/routeApp.ts`
  - the reusable HTTP app that both entries serve
  - owns route registration, but not the outer server process

This split allows in-process callers, especially tests, to use the HTTP app
without importing a server entry point and its runtime side effects.

### 2. Transport Layer

This is the HTTP-facing layer: `packages/api/src/routes/**`, request
validators, response shaping, and auth/session middleware.

For service-backed routes, this layer:

- parses and validates the request
- loads auth/session context
- calls a service
- converts service results and errors into HTTP responses
- publishes best-effort realtime hints after successful document mutations

Document routes own that last step: `respondWithDocumentCreate` in
`routes/documents/mutations.ts` calls `publishDocumentUpdateCreatedEvent` after
the service returns. A publication failure does not roll back a committed
mutation; realtime hints prompt clients to fetch verified state.

Routes do not import workflows or access modules. Route-local logic is limited
to thin adapters and simple endpoints that need no service orchestration.

### 3. Application Service Layer

This is the route-facing use-case facade:

- `packages/api/src/services/{auth,billing,blobs,containers,documents}/**`
- `packages/api/src/services/{organizations,principals,root}/**`
- `packages/api/src/services/runtime.ts`

This layer:

- accepts validated inputs instead of raw HTTP context
- depends on explicit infrastructure seams from `ApiServiceRuntime`
- delegates transaction orchestration to workflows

App tests that need real backend behavior call `useTestApiAppHandlers`
(`packages/app/test/helpers/mswServer.ts`), which proxies every API request
into `createRouteApp`, so they exercise these services without a second
backend implementation. The multi-party scenarios in `packages/bob-and-alice`
serve the same route app over real HTTP through the `@tearleads/api/test-runtime`
export and drive full SDK clients against it.

### 4. Workflow Layer

`packages/api/src/workflows/**` owns transaction-scoped orchestration: a
workflow opens the transaction when one is required and passes the same
executor through every access-plane read and write it composes. It is the only
production layer that imports `access/read` and `access/write`. See
[the workflow rules](../packages/api/src/workflows/README.md).

### 5. Access and Domain Helpers

Reusable logic that is more specific than generic infrastructure but lower
level than a use case:

- `packages/api/src/access/**`: signed manifests, KEK state, content-key
  bundles, attachment bindings, and principal state and member-envelope stores
  (see [the access layout](../packages/api/src/access/README.md))
- `packages/api/src/documents/**`: document update storage, sync baselines,
  and edit attribution

This code models protocol and domain rules, not HTTP transport.

### 6. Infrastructure Layer

This is the lowest layer:

- `packages/api-shared/src/adapters/postgres.ts`
- `packages/api/src/adapters/keyValueStore.ts`
- `packages/api/src/adapters/pubSub.ts`
- `packages/api/src/adapters/blobObjectStore.ts`
- `packages/api/src/adapters/s3BlobObjectStore.ts`
- session token creation in `packages/api/src/middleware/session.ts`

This layer exposes capabilities, not use-case policy.

## Service Runtime

The service runtime boundary is `ApiServiceRuntime` in
`packages/api/src/services/runtime.ts`. It injects the infrastructure that
application services need:

- database access
- blob object storage
- key-value storage
- event publishing
- session token issuance
- the document sync cursor HMAC key

This boundary exists so that:

- route handlers and tests can call the same service code
- app tests do not need to import an API server entry point
- MSW does not need a second fake implementation of backend behavior

Database-only services keep this facade. They use
`createDatabaseWorkflowService` to select `runtime.db` without repeating a
delegate-only wrapper. Production routes must not bypass the service boundary
by importing workflows or selecting the database themselves.

Rule: a use case important enough to test from app UI through MSW lives in a
service module, not only in a route body.

## Service Coverage

The service layer covers these route-backed capabilities:

- auth challenge, verify, register, and user-identity lookup
- multipart blob staging, blob downloads, raw blob byte reads, attachment
  binding, and detach mutations
- container creation, metadata-document creation, listing, sharing, rekey,
  movement, re-citation, deletion, KEK-log reads, replacement lineage, and
  document listing
- document creation, sync storage, purge, writer projection, and edit
  attribution
- document attachment listing
- document link and unlink mutations
- principal policy reads and writes, and projection policy history
- organization creation, profile, roster, group-authoring, data-usage, policy
  history, and membership operations, plus the organization read-model feed
  backed by roster rows and reserved `Admins` / `Members` group policy
  reachability; grant and user-detail presentation derive from the local
  projection and have no HTTP routes of their own
- organization billing and the billing webhooks
- root operator lookups, reports, and account suspension

The session routes are route-local. `logout` composes `requireAuth` and
`destroySession` directly, and `/auth/sessions` delegates to injected session
listing and destruction dependencies rather than application-service logic.

Container list and container document listing pass their injected runtime
executor through the access helpers they call, so in-process callers use the
same injected database adapter inside those service paths.

Auth challenge and verify services return service-level success results and
typed service errors. Their routes own the HTTP status and response-body
mapping.

The container mutation workflow creates container metadata documents and
persists them through the helpers under
`packages/api/src/workflows/containers/mutations/shared/`. Auth registration
and `POST /containers/with-metadata-document` reach that workflow code without
importing from `routes/**`.

API route tests, API integration helpers, and in-process API integration tests
call `routeApp` directly instead of importing a server entry point.

Blob staging is implemented as blob services. The
`/blobs/stages/multipart` routes validate request shape and map service errors
to HTTP responses, while the services own digest and byte-length validation,
staged-row creation, object-store multipart state, per-part signed upload URLs,
binary part upload for non-signing stores, and completion. The client supplies
the destination organization from the verified document projection. Stages
persist that organization, use
`organizations/<organizationId>/blob-stages/<stageId>` keys, and can only be
promoted into that organization. The full key is preserved in `blobs` and
`blob_audit_objects` through physical deletion retries. Organization purge also
expires its staged uploads and waits for their object-store cleanup.

Document attachment listing is implemented as a document service. The
`/documents/:documentId/attachments` route maps service errors to HTTP
responses, while the service owns document-read authorization and active
attachment binding lookup through the injected runtime database. It also loads
the latest blob content-key bundle for each active blob from the blob
content-key store, so callers do not rely on encrypted blob bytes to carry key
material.

Blob reads are implemented as blob services. The `/blobs/:blobId/download`
JSON route and the `/blobs/:blobId/bytes` octet-stream route map service errors
to HTTP responses, while the services own blob-read authorization, committed
blob lookup, object-store reads, and digest recalculation through the injected
runtime database. The download route returns either an API byte source or a
signed object-store URL. Blob reads return only committed encrypted bytes and
digest metadata; blob key bundles come from attachment listing and bind
responses.

Document creation and sync writes are implemented by signed mutation
services. The document route validates request shape and maps service
errors to HTTP responses. The `services/documents/documentMutations` facade
delegates to `workflows/documents/mutations`, which owns transaction boundaries
and composes manifest verification, content-key target validation, write-header
verification, and update storage through the access layer.
The neutral `documentUpdateStore` owns causally-missing update reads for
sync responses.

Blob attachment mutations are signed blob services. They own server-visible
attachment binding changes, staged blob promotion, blob key-target validation,
and blob reachability cleanup.

## Why `routeApp` Exists

`routeApp` is the reusable HTTP app. It lets these callers share one transport
definition:

1. the Workers entry in `worker/index.ts` and the Bun server in `index.ts`
2. in-process test proxying from the app test harness
3. route-level API tests

Without that split, importing the app from tests pulls in process-level
concerns that do not belong in a lightweight in-process test path.

## Testing Model

- **Route tests** verify request validation, auth middleware behavior, and
  response codes and shaping.
- **Service tests** verify use-case behavior, transactional correctness, and
  orchestration across domain helpers.
- **App tests** verify real UI flows. MSW answers with canned fixtures by
  default; a test that needs real request/response semantics calls
  `useTestApiAppHandlers` to proxy into `routeApp`.

Canned handlers return fixtures only. Behavior that needs backend semantics
goes through the proxy, so MSW never becomes a second backend implementation.

## Design Rules

1. Hono route files stay thin.
2. Services accept validated arguments, not `Context`.
3. Services depend on explicit runtime interfaces, not hidden globals where
   practical.
4. Workflows own transactions; only workflows compose access reads and writes.
5. Domain helpers model access/document/attachment logic and remain reusable.
6. Infrastructure adapters do not own business policy.
7. App-side integration tests call shared service logic or `routeApp`, not a
   server entry point.
8. Protocol planes can cross service boundaries, but transport concerns do not
   leak downward.
