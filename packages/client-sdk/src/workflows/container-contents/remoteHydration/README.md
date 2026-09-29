# Remote Hydration Internals

These modules support `../remoteHydration.ts`, the workflow facade that syncs
remote container tree state into the local `container-contents` query facade.

- `types.ts` owns shared hydration DTOs, runtime contracts, and host types.
- `childIndex.ts` maintains the in-memory parent/child index used during a
  hydration pass.
- `reconciliation.ts` reconciles local-only root and system containers with
  their remote counterparts.

Keep API pagination and watermark orchestration in `../remoteHydration.ts`.
Keep React-free store scheduling in `packages/client-sdk/src/stores`.

A page with a concurrently changed live item or tombstone remains unacknowledged:
its watermark and restoration-completion callback must not advance. Independent
pages and newly discovered child lanes still run. This prevents an unrelated
metadata sync from leaving a newly shared root permanently without children.
Generation changes, unavailable responses, and verification errors still stop
the pass; an incomplete page is not retried automatically within that pass.
