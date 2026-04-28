# API Architecture

## Summary

This document defines two related but distinct structures:

- protocol planes describe *what kind of state* we are handling
- API layers describe *where code lives* and *what each part is allowed to do*

Those are related, but they are not the same axis.

## Protocol Planes

The protocol has three main planes:

1. document plane
2. attachment plane
3. access plane

These are described in [loro-e2ee-sync-protocol.md](./loro-e2ee-sync-protocol.md).

A single use case can touch more than one plane. For example:

- `shareContainer` is mostly access-plane work
- `createContainer` touches access plane and metadata-document setup
- signed V2 document/blob mutations span document, attachment, and access
  planes

Protocol planes are a domain model, not a source-tree layout rule.

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

- `packages/api/src/adapters/postgres.ts`
- `packages/api/src/adapters/redis.ts`
- `packages/api/src/adapters/redisPubSub.ts`
- session token creation

This layer exposes capabilities, not use-case policy.

## Service Runtime

The service runtime boundary is `ApiServiceRuntime` in
`packages/api/src/services/runtime.ts`.

It injects the infrastructure required by application services:

- database access
- key-value storage
- event publishing
- principal signer trust lookup
- session token issuance

This boundary exists so that:

- route handlers and tests can call the same service code
- app tests do not need to import the full API server entrypoint
- MSW does not need a second fake implementation of backend behavior

Rule:

- if a use case is important enough to test from app UI through MSW, it must
  live in a service module, not only in a route body

## Service Coverage

The service layer covers these route-backed capabilities:

- auth challenge, verify, register, and encapsulation-key lookup
- blob staging and blob reads
- container creation, listing, sharing, movement, and document listing
- container metadata document creation for auth registration and container
  creation
- V2 document creation, sync storage, and writer projection
- document attachment listing
- V2 blob staging, attachment binding, and detach mutations
- document link and unlink mutations
- principal policy read and write operations

The `logout` route remains route-local. It composes `requireAuth` and
`destroySession` directly and does not orchestrate application-service logic.

Container list and container document listing pass their injected runtime
executor through the access helpers they call, so in-process callers do not
fall back to the global database adapter inside those service paths.

Auth challenge and verify services return service-level success results and
typed service errors. Their routes own the HTTP status and response-body
mapping.

`packages/api/src/services/containers/containerMetadata.ts` owns container
metadata document creation. Auth registration and container creation call it
from service code without importing from `routes/**`.

API route tests, API integration helpers, and in-process API integration tests
call `routeApp` directly instead of importing the server entrypoint.

Blob staging is implemented as a blob service. The `/blobs/stage` route
validates request shape and maps service errors to HTTP responses, while the
service owns digest/byte-length validation and staged-row creation.

Document attachment listing is implemented as a document service. The
`/documents/:documentId/attachments` route maps service errors to HTTP
responses, while the service owns document-read authorization and active
attachment binding lookup through the injected runtime database.

Blob reads are implemented as a blob service. The `/blobs/:blobId` route
maps service errors to HTTP responses, while the service owns blob-read
authorization, committed blob lookup, current key-target projection,
and digest recalculation through the injected runtime database.

Document creation and sync writes are implemented by signed V2 mutation
services. The V2 document route validates request shape and maps service
errors to HTTP responses; `documentV2Mutations` owns manifest verification,
content-key target validation, write-header verification, and update storage.
The neutral `documentUpdateStore` owns causally-missing update reads for V2
sync responses.

The old direct-recipient `createLoroRouter` and
`/documents/:documentId/commit-change` adapters have been retired. Blob
attachment mutations now use signed V2 blob routes instead of the deleted
document commit/change service.

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

## Follow-up Work

The route extraction work is complete. New work in this area belongs in
separate follow-up issues rather than a standing migration list in this
document.
