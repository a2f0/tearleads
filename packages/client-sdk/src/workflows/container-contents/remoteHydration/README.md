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

Every listed container must prove its immutable metadata document ID before
hydration changes a metadata record or its pending updates. The listing can
trigger verification but cannot choose that target. Verified bindings are cached
by database, organization and container ID; ordinary parent edges are excluded
because moves can change them. Root/system parents remain fixed. Tombstone
recovery additionally verifies current placement against durable checkpoints.
