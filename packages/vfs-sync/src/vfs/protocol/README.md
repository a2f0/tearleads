# Protocol Layer

Deterministic protocol primitives:

- Cursor encode/decode and ordering
- CRDT operation types, canonical ordering, and reconciliation
- Protocol harnesses and replay consistency tests

No transport or HTTP behavior should be introduced here.

## CRDT Operation Types

| Type | Description |
|------|-------------|
| `acl_add` | Grant access to a principal on an item |
| `acl_remove` | Revoke access from a principal on an item |
| `link_add` | Add a parent-child link (multi-parent allowed) |
| `link_remove` | Remove a parent-child link |
| `link_reassign` | Atomically reassign a child to a new parent (has-one semantics) |
| `item_upsert` | Create or update an item |
| `item_delete` | Delete an item |

### `link_reassign` — Has-One Parent Enforcement

`link_reassign` provides opt-in single-parent enforcement for VFS object types
where a child must belong to exactly one container (e.g., a health reading
assigned to a single contact).

**Semantics:**

1. Tombstone all existing parent links for the given `childId` that have older
   stamps than the reassign operation.
2. Add the new `(parentId, childId)` link.
3. Both steps share the same stamp (`occurredAtMs` + `replicaId` + `writeId`).

**Merge rules:**

- When merging a `link_reassign`, the CRDT compares its stamp against all
  existing link registers for the same `childId`.
- Any existing link with an older stamp and a different `parentId` is
  tombstoned (`present = false`).
- Two concurrent `link_reassign` ops from different replicas converge
  deterministically via the standard tiebreaker chain:
  `occurredAtMs → opId → replicaId → writeId`.
- `link_reassign` is opt-in per operation — callers choose when single-parent
  semantics apply. Existing `link_add` behavior (multi-parent) is unchanged.

**State tracking:**

`InMemoryVfsCrdtStateStore` maintains a `childReassignInfo` map
(`childId → { parentId, stamp }`) that tracks the most recent reassign per
child. This enables early rejection of operations that are outdated relative
to a newer reassign.

**Guardrails:**

- Self-referential links (`parentId === childId`) are rejected as invalid.
- `childId` mismatches between operation payload and prepared operation are
  rejected.

**Test coverage:** `syncCrdtLinkReassign.test.ts` covers concurrent reassign
convergence, reassign-vs-link_add ordering, idempotent replay, out-of-order
delivery, cross-parent tombstoning, self-referential rejection, and
same-parent no-op behavior.
