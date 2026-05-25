# Sync Coordination

This directory owns the shared in-process scheduler for SDK sync work. It does
not own a sync protocol, API request shape, persistence store, or blob store.

`syncCoordinator.ts` keeps one coordinator per `DomainScope`. A domain scope is
the identity token for the active local database/signing runtime, so sync lanes
registered for different scopes do not share pending-work state.

## What It Coordinates

A coordinator manages named lanes. Each lane supplies a `run()` callback, and
callers trigger that callback through `requestSync()`.

Current production lanes include:

- `documents:${localId}` lanes registered by document stores.
- `container-contents` lane registered by the explorer/container contents
  store.

The coordinator guarantees that a single lane does not run concurrently with
itself. If `requestSync()` is called while that lane is already running, the
request is coalesced into one follow-up pass after the current pass finishes.
Different lane keys are independent and may run at the same time.

## Reads, Writes, Documents, And Blobs

The coordinator is not specifically read-only or write-only. It can schedule
either because it only calls the lane's `run()` callback.

The current document lanes do both sides of document sync:

- pushes local pending document updates through the document sync workflow;
- pulls and applies remote document updates returned by that workflow;
- creates a remote document when local pending work needs one;
- uploads pending attachment blob bytes before regular document-state sync when
  a document has attachment mutations.

Those blob uploads are part of the document store's sync lanes. The byte stores,
blob envelopes, and attachment persistence live elsewhere under `data/blobs`,
`data/blob*`, and document persistence modules. This coordinator never reads or
writes blob bytes directly.

Container contents also uses lanes for domain-specific sync work. Container
contents sync creates pending remote containers and syncs container metadata
documents.

## What Belongs Here

Keep this directory limited to shared scheduling primitives and neutral sync
runtime helpers:

- lane registration and request coalescing;
- pending-work and idle/settle observation for tests and runtime idle helpers;
- common "sync prerequisites regained" checks such as online/auth/key restore;
- common teardown-error detection for destroyed database clients.

Do not add domain-specific document, container, blob, or persistence
logic here. Add that to the owning workflow/store lane and register it with the
coordinator.

## Import Boundary

Production workflow modules may import this internal data helper to register
their lanes. Cross-package callers and host tests should use the sync workflow
facade at `@tearleads/client-sdk` when they need to observe
pending sync work or wait for sync to settle.
