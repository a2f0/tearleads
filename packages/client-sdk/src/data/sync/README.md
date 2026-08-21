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

- `container-contents`, a `structural` lane registered by the
  explorer/container contents store.
- `documents:${localId}`, `document` lanes registered by document stores.
- `blob-upload:${blobId}`, observational rows updated by attachment upload
  callbacks for diagnostics. These are not coordinator-pumped lanes.

The coordinator guarantees that a single lane does not run concurrently with
itself. If `requestSync()` is called while that lane is already running, the
request is coalesced into one follow-up pass after the current pass finishes.
The coordinator also serializes lanes for a domain scope and drains them by
phase. All queued `structural` work runs before queued `document` work. This
keeps container creates, moves, and container metadata sync ahead of document
creation, Loro update sync, and attachment blob binding.

The pump is non-preemptive: a lane pass that has already started is allowed to
finish. New higher-priority requests are selected before the next lower-priority
lane pass starts.

The coordinator also maintains cached read-only telemetry snapshots. A snapshot
contains lane phase, status, request/run/error counts, last action timestamps,
the last handled error message, and an optional blob storage key for navigation.
It is for diagnostics and UI observation only; callers still trigger sync
through the lane owners. Manual Sync requests only pump-driven structural and
document lanes. It never executes an observational blob row or fabricates a
terminal upload state.

## Reads, Writes, Documents, And Blobs

The coordinator is not specifically read-only or write-only. It can schedule
either because it only calls the lane's `run()` callback.

The current document lanes do both sides of document sync:

- pushes local pending document updates through the document sync workflow;
- pulls and applies remote document updates returned by that workflow;
- creates a remote document when local pending work needs one;
- uploads pending attachment blob bytes before regular document-state sync when
  a document has attachment mutations.

Those blob uploads are part of the document store's executable sync lanes. The
visualizer can show separate blob-upload telemetry, but those rows are driven by
the real upload workflow and never own or schedule work. The byte stores, blob
envelopes, and attachment persistence live elsewhere under `data/blobs`,
`data/blob*`, and document persistence modules. This coordinator never reads or
writes blob bytes directly.

Container contents also uses lanes for domain-specific sync work. Container
contents sync creates pending remote containers, applies pending container move
intents, and syncs container metadata documents before document lanes drain.

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
facade at `@symcrypt/client-sdk` when they need to observe
pending sync work or wait for sync to settle.
