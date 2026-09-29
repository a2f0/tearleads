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
because moves can change them. Root/system parents remain fixed. Separate
1,000-entry buckets keep ordinary folder discovery from evicting root/system
reconciliation roles. Tombstone
recovery additionally verifies current placement against durable checkpoints.

A held folder keeps its organization and metadata document id. Hydration loads
the held binding (in-memory state, else the durable row or retained dormant
metadata). A listing that repeats a held ordinary binding needs no second proof.
A conflicting proof is accepted only when the session user's own signed create
re-homed the folder (purged-organization recovery reuses container ids); the
rebind resets the metadata record's remote stream and keeps queued edits. Any
other conflict is refused before placement pins advance or the role is cached.
Metadata-mutation and hydration-commit transactions recheck the durable binding;
a conflicting dormant record is refused, never purged. Page hydration prefetches
newly discovered folders' projections four at a time; verification stays
sequential.

A page with a concurrently changed live item or tombstone remains unacknowledged:
its watermark and restoration-completion callback must not advance. Independent
pages and newly discovered child lanes still run. This prevents an unrelated
metadata sync from leaving a newly shared root permanently without children.
A rejected destination proof is reported and leaves that folder unapplied;
independent folders and lanes continue. Its page remains unacknowledged and
restoration cleanup stays pending. Generation changes, unavailable lane responses
and unexpected runtime/storage errors still stop the pass. An incomplete page
is not retried automatically within that pass.
