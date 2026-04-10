# API Architecture

## Summary

Yes, these are layers.

The important distinction is:

- protocol planes describe *what kind of state* we are handling
- API layers describe *where code lives* and *what each part is allowed to do*

Those are related, but they are not the same axis.

## Protocol Planes

The protocol currently has three main planes:

1. document plane
2. attachment plane
3. access plane

These are described in [loro-e2ee-sync-protocol.md](./loro-e2ee-sync-protocol.md).

A single use case can touch more than one plane. For example:

- `shareContainer` is mostly access-plane work
- `createContainer` touches access plane and metadata-document setup
- `commit-change` spans document plane, attachment plane, and access plane

So the planes are a domain/protocol concept, not a source-tree layout rule.

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

This split exists so in-process callers, especially tests, can use the HTTP app
without importing the full server entrypoint and its runtime side effects.

### 2. Transport Layer

This is the HTTP-facing layer.

Examples:

- `packages/api/src/routes/**`
- request validators
- response shaping
- auth/session middleware

This layer does only a few things for extracted routes:

- parse and validate the request
- load auth/session context
- call a service
- convert service results/errors into HTTP responses

It does not own large business-logic transactions once a use case has been
extracted. The remaining route-level exceptions are listed in the future-work
section.

### 3. Application Service Layer

This is the use-case orchestration layer.

Examples:

- `packages/api/src/services/auth/**`
- `packages/api/src/services/containers/**`
- `packages/api/src/services/runtime.ts`

This layer:

- owns transaction boundaries for a use case
- orchestrates access/document/attachment work
- depends on explicit infrastructure seams
- accepts validated inputs instead of raw HTTP context

This is the layer that the app-side MSW harness calls when it wants real
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

## Service Seams

The current seam is `ApiServiceRuntime` in
`packages/api/src/services/runtime.ts`.

That seam exists to inject the infrastructure a service needs:

- database access
- key-value storage
- event publishing
- session token issuance

The point is not dependency injection for its own sake. The point is:

- route handlers and tests can call the same service code
- app tests do not need to import the full API server entrypoint
- MSW does not need a second fake implementation of backend behavior

The rule is:

- if a use case is important enough to test from app UI through MSW, it must
  live in a service module, not only in a route body

## Current Extraction Boundary

The first extracted service seam currently covers:

- auth challenge
- auth verify
- auth register
- auth encapsulation-key lookup
- container create
- container list
- container share
- container document listing
- container metadata document creation for auth registration and container
  creation

That is enough for the current app-side dual-pane share flows.

Container list and container document listing pass their injected runtime
executor through the access helpers they call, so in-process callers do not
fall back to the global database adapter inside those service paths.

`packages/api/src/services/containers/containerMetadata.ts` owns container
metadata document creation. Auth registration and container creation call it
from service code without importing from `routes/**`.

The document routes are not fully extracted yet. In particular, the heavier
document/blob use cases still have route-level orchestration. Those remaining
exceptions are tracked below as future work.

## Why `routeApp` Exists

`routeApp` is the reusable HTTP app.

It allows three different callers to share one transport definition:

1. the real server process in `index.ts`
2. in-process test proxying from the app test harness
3. route-level API tests

Without that split, importing the app from tests tends to pull in process-level
concerns that do not belong in a lightweight in-process test path.

## Testing Model

The intended testing pyramid is:

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

The key constraint is:

- MSW reuses backend logic
- MSW does not become a second backend implementation

## Design Rules

The rules are:

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

## Future Work

The remaining extraction targets are:

- document sync orchestration
- document commit/change orchestration
- blob stage/get orchestration

Those are the places where document plane, attachment plane, and access plane
meet most heavily, so they are also the places where a clean service boundary
will pay off the most.
