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

The executable route and validator shapes are defined by `packages/api/src/routes`
and `packages/validators/src`. Documentation should treat those files as the
source of truth.

Write surfaces:

| Capability | Route | Validator |
| --- | --- | --- |
| Request auth challenge | `POST /auth/challenge` | `ChallengeRequest` |
| Verify auth challenge | `POST /auth/verify` | `VerifyRequest` |
| Register identity and bootstrap root state | `POST /auth/register` | `RegistrationRequest` |
| Destroy current session | `POST /auth/logout` | n/a |
| Destroy a user session | `DELETE /auth/sessions/:sessionId` | n/a |
| Store signed organization policy and member envelopes atomically | `PUT /principals/organization/:principalId/policy` | `PutPrincipalPolicyRequest` |
| Atomically advance a group policy and its signed organization-directory head | `PUT /organizations/:organizationId/groups/:groupId/policy-commit` | `CommitOrganizationGroupPolicyRequest` |
| Atomically create an organization group and advance its signed directory | `POST /organizations/:organizationId/groups` | `CreateOrganizationGroupWithPolicyRequest` |
| Bind encrypted roster profile document | `PUT /organizations/:organizationId/roster/:userId` | `UpdateOrganizationRosterEntryRequest` |
| Create container with metadata document | `POST /containers/with-metadata-document` | `ContainerCreateWithMetadataDocumentRequest` |
| Create container | `POST /containers` | `ContainerMutationRequest` |
| Share container | `POST /containers/:containerId/share` | `ContainerMutationRequest` |
| Revoke container grant | `POST /containers/:containerId/revoke` | `ContainerMutationRequest` |
| Rekey container | `POST /containers/:containerId/rekey` | `ContainerMutationRequest` |
| Move container | `POST /containers/:containerId/move` | `ContainerMutationRequest` |
| Delete container | `DELETE /containers/:containerId` | n/a |
| Create document | `POST /documents` | `DocumentCreateRequest` |
| Link document to container | `POST /documents/:documentId/link` | `DocumentLinkSetMutationRequest` |
| Unlink document from container | `POST /documents/:documentId/unlink` | `DocumentLinkSetMutationRequest` |
| Sync encrypted Loro updates | `POST /documents/:documentId/sync` | `DocumentSyncRequest` |
| Initiate multipart blob stage | `POST /blobs/stages/multipart` | `InitiateMultipartBlobStageRequest` |
| Upload multipart blob part as bytes | `PUT /blobs/stages/multipart/:stageId/parts/:partNumber/bytes` | headers plus octet stream |
| Complete multipart blob stage | `POST /blobs/stages/multipart/:stageId/complete` | `CompleteMultipartBlobStageRequest` |
| Bind or replace blob attachment | `POST /blobs/:blobId/attachment-bindings` | `BlobAttachmentBindRequest` |
| Detach blob attachment | `POST /blobs/:blobId/attachment-bindings/:bindingId/detach` | `BlobAttachmentDetachRequest` |

Read surfaces:

| Capability | Route |
| --- | --- |
| Health check | `GET /` |
| List auth sessions | `GET /auth/sessions` |
| Get complete user identity | `GET /auth/user-identity/:userId` |
| List containers | `GET /containers` |
| List container documents | `GET /containers/:containerId/documents` |
| Get container writer projection | `GET /containers/:containerId/writer-projection` |
| Get document writer projection | `GET /documents/:documentId/writer-projection` |
| List active document attachments | `GET /documents/:documentId/attachments` |
| Get committed blob bytes | `GET /blobs/:blobId/bytes` |
| Get multipart blob stage status | `GET /blobs/stages/multipart/:stageId` |
| Get principal policy bundle | `GET /principals/:principalType/:principalId/policy` |
| List organization directory | `GET /organizations/:organizationId/directory` |
| Get organization data usage | `GET /organizations/:organizationId/data-usage` |
| List organization groups | `GET /organizations/:organizationId/groups` |
| List organization group members | `GET /organizations/:organizationId/groups/:groupId/members` |
| Reconcile the organization read model | `GET /organizations/:organizationId/read-model` |

The document sync request names protocol fields:
`contentKeyEpoch`, `expectedLinkSetManifestHash`, `expectedTargetHash`,
optional `contentKeyBundle`, optional `containerRekeys`, optional
`authorizingContainerPathRefs`, `localVersionVector`, optional `minLsn`, and
`outgoingUpdates[]` with per-update `writeHeader`. The path references identify
signed container manifests already held by the API; the expected link-set hash
pins the server-resolved document manifest.
Responses return `acceptedOutgoingUpdateIds`, `commitLsn`, `contentKeyBundle`,
the required `contentKeyBundles` array (empty when no additional epoch bundle is
needed), `documentKekTargets`, and encrypted `updates[]`.

## Code Layers

The API is organized in layers like this:

### 1. Entry Points

These are the top-level process and app bindings.

- `packages/api/src/index.ts`
  - server entrypoint
  - owns the HTTP server binding and websocket upgrade handling
- `packages/api/src/routeApp.ts`
  - reusable HTTP app
  - owns route registration, but not the outer server process

This split allows in-process callers, especially tests, to use the HTTP app
without importing the full server entrypoint and its runtime side effects.

### 2. Transport Layer

This is the HTTP-facing layer.

Examples:

- `packages/api/src/routes/**`
- request validators
- response shaping
- auth/session middleware

For service-backed routes, this layer:

- parses and validates the request
- loads auth/session context
- calls a service
- converts service results and errors into HTTP responses

It does not own business-logic transactions once a use case has been extracted
into a service module. Route-local logic is limited to thin adapters and simple
endpoints that do not require service orchestration.

### 3. Application Service Layer

This is the use-case orchestration layer.

Examples:

- `packages/api/src/services/auth/**`
- `packages/api/src/services/blobs/**`
- `packages/api/src/services/containers/**`
- `packages/api/src/services/documents/**`
- `packages/api/src/services/organizations/**`
- `packages/api/src/services/principals/**`
- `packages/api/src/services/runtime.ts`

This layer:

- owns transaction boundaries for a use case
- orchestrates access/document/attachment work
- depends on explicit infrastructure seams
- accepts validated inputs instead of raw HTTP context

This is the layer reused by the app-side MSW harness when tests need real
backend behavior without duplicating route logic.

### 4. Domain and Protocol Helpers

This layer holds the reusable logic that is more specific than generic
infrastructure, but lower level than a full use case.

Examples:

- `packages/api/src/access/**`
- document-access materialization
- blob-access materialization
- principal state and member-envelope stores
- container metadata document creation

This code models protocol/domain rules, not HTTP transport.

### 5. Infrastructure Layer

This is the lowest layer.

Examples:

- `packages/api-shared/src/adapters/postgres.ts`
- `packages/api/src/adapters/redis.ts`
- `packages/api/src/adapters/redisPubSub.ts`
- `packages/api/src/adapters/blobObjectStore.ts`
- `packages/api/src/adapters/s3BlobObjectStore.ts`
- session token creation

This layer exposes capabilities, not use-case policy.

## Service Runtime

The service runtime boundary is `ApiServiceRuntime` in
`packages/api/src/services/runtime.ts`.

It injects the infrastructure required by application services:

- database access
- blob object storage
- key-value storage
- event publishing
- session token issuance

This boundary exists so that:

- route handlers and tests can call the same service code
- app tests do not need to import the full API server entrypoint
- MSW does not need a second fake implementation of backend behavior

Database-only services still retain this facade. They use
`createDatabaseWorkflowService` to select `runtime.db` without repeating a
delegate-only wrapper. Production routes must not bypass the service boundary
by importing workflows or selecting the database themselves.

Rule:

- if a use case is important enough to test from app UI through MSW, it must
 live in a service module, not only in a route body

## Service Coverage

The service layer covers these route-backed capabilities:

- auth challenge, verify, register, and user-identity lookup
- multipart blob staging, blob reads, raw blob byte reads, attachment
  binding, and detach mutations
- container creation, metadata-document creation, listing, sharing, movement,
  deletion, and document listing
- container metadata document creation for auth registration and container
 creation
- document creation, sync storage, and writer projection
- document attachment listing
- document link and unlink mutations
- principal policy read and write operations
- org-manager roster, directory, group-authoring, and data-usage operations,
  plus the protocol-v4 organization read-model feed backed by roster rows and
  reserved `Admins` / `Members` group policy reachability; grant and user-detail
  presentation are derived from the local projection, with no dedicated legacy
  HTTP routes

The session routes remain route-local. `logout` composes `requireAuth` and
`destroySession` directly, and `/auth/sessions` delegates to injected session
listing/destruction dependencies rather than application-service logic.

Container list and container document listing pass their injected runtime
executor through the access helpers they call, so in-process callers use the
same injected database adapter inside those service paths.

Auth challenge and verify services return service-level success results and
typed service errors. Their routes own the HTTP status and response-body
mapping.

Container metadata document creation is handled by the container mutation
workflow and persisted through helpers in
`packages/api/src/workflows/containers/mutations/shared/persistence.ts`. Auth
registration and `POST /containers/with-metadata-document` call that workflow
code without importing from `routes/**`.

API route tests, API integration helpers, and in-process API integration tests
call `routeApp` directly instead of importing the server entrypoint.

Blob staging is implemented as blob services. The
`/blobs/stages/multipart` routes validate request shape and map service errors
to HTTP responses, while the services own digest/byte-length validation,
staged-row creation, object-store multipart state, binary part upload, and
completion.

Document attachment listing is implemented as a document service. The
`/documents/:documentId/attachments` route maps service errors to HTTP
responses, while the service owns document-read authorization and active
attachment binding lookup through the injected runtime database. It also loads
the latest blob content-key bundle for each active blob from key-package
storage, so callers do not rely on encrypted blob bytes to carry key material.

Blob reads are implemented as a blob service. The `/blobs/:blobId` JSON route
and `/blobs/:blobId/bytes` octet-stream route map service errors to HTTP
responses, while the service owns blob-read authorization, committed blob
lookup, object-store reads, and digest recalculation through the injected
runtime database. Blob read responses return only committed encrypted bytes and
digest metadata; blob key bundles are returned by attachment listing and bind
responses.

Document creation and sync writes are implemented by signed mutation
services. The document route validates request shape and maps service
errors to HTTP responses; `documentMutations` owns manifest verification,
content-key target validation, write-header verification, and update storage.
The neutral `documentUpdateStore` owns causally-missing update reads for
sync responses.

Blob attachment mutations are implemented by signed blob routes. They own
server-visible attachment binding changes, staged blob promotion, blob
key-target validation, and blob reachability cleanup.

## Why `routeApp` Exists

`routeApp` is the reusable HTTP app.

It allows three callers to share one transport definition:

1. the real server process in `index.ts`
2. in-process test proxying from the app test harness
3. route-level API tests

Without that split, importing the app from tests tends to pull in process-level
concerns that do not belong in a lightweight in-process test path.

## Testing Model

The testing model is:

### Route Tests

Route tests verify:

- request validation
- auth middleware behavior
- response codes and shaping

### Service Tests

Service tests verify:

- use-case behavior
- transactional correctness
- orchestration across domain helpers

### App Tests

App tests verify:

- real UI flows
- real request/response semantics
- shared service behavior through MSW-backed handlers or `routeApp` proxying

Constraint:

- MSW reuses backend logic
- MSW does not become a second backend implementation

## Design Rules

Rules:

1. Hono route files stay thin.
2. Services accept validated arguments, not `Context`.
3. Services depend on explicit runtime interfaces, not hidden globals where
 practical.
4. Domain helpers model access/document/attachment logic and remain reusable.
5. Infrastructure adapters do not own business policy.
6. App-side integration tests call shared service logic or `routeApp`,
 not import the full server entrypoint.
7. Protocol planes can cross service boundaries, but transport concerns do
 not leak downward.
