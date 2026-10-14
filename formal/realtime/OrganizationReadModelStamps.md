# Organization Read-Model Stamps

[`OrganizationReadModelStamps.tla`](./OrganizationReadModelStamps.tla) models
the organization read-model cursor and its lossy hints (#2522). Each source
mutation advances the per-organization head and stamps every lane or group it
changed with the new cursor, and a delta from cursor `c` reloads exactly the
entities whose stamp exceeds `c`. Hints that arrive while the client's own Org
Manager mutation is active are held. See the
[ordering and replay contract](../../docs/organization-read-model-sync.md#ordering-and-replay).

| Model action or predicate | Production seam |
| --- | --- |
| `Begin` | A mutation writes uncommitted domain rows (group row, tombstone, roster, policy) before `appendOrganizationReadModelChangeInTransaction` |
| `AdvanceHead` | `advanceOrganizationReadModelHead` increments the cursor and stamps head-row lanes in one update that holds the head row lock until commit |
| `GroupStamp` | `stampGroupMembershipChanges` stamps group rows and tombstones with the cursor that update returned |
| `Commit` / `Abort` | `appendOrganizationReadModelChangeInTransaction` runs in the source mutation's transaction, which commits or rolls back its domain rows, head, and stamps together; the hint is published only after commit |
| `Deliver` | `handleOrganizationReadModelHint` counts every hint and holds it while the Org Manager mutation is active; otherwise it schedules a pass |
| `Lose` | `publishOrganizationReadModelChanged` is best-effort, and a socket can drop a hint |
| `EndMutation` | `releaseDeferredOrganizationReadModelHint` drops held hints that `isOrganizationReadModelHintCaughtUp` reports covered and schedules a pass otherwise |
| `Send` | `trackOrganizationReadModelCatchUp` records the hint count before `loadDirectoryAndGroupsAfterMutation` starts a fresh pass |
| `Read` | `lockOrganizationReadModelHeadInTransaction` reads the head and lane stamps under the shared lock, and `loadDeltaResponse` reloads every lane stamped after the cursor |
| `Finish` / `Fail` | `applyOrganizationReadModelResponse` applies the page and cursor atomically; a failure in `reconcileOrganizationDirectoryAndGroups` keeps the last-known-good projection |
| `CursorCoversChanges` | `loadDeltaResponse` never lets `applyOrganizationReadModelResponse` adopt a cursor that covers a change the page did not carry |
| `CaughtUpClientIsCurrent` | After `applyOrganizationReadModelResponse` adopts the head cursor, the local projection equals the server's current lanes |
| `BehindClientHasTrigger` | A client behind a committed change still has a hint, held hint, or pass from `scheduleOrganizationReadModelReconciliationAfterActivePass` owed, unless a hint was lost or a pass failed |

Bounds are two writers and one client. Each writer changes the head-row lane,
the group row, or both, and may roll back at any point. Committed changes
publish coalesced hints that may be lost. The client's single mutation window
may open before, between, or after the commits, and it may send its explicit
post-mutation pass at any point inside the window. The `directory` entity
stands for every lane stamped on the head row, since all of them are written by
the same update; `group` stands for a membership stamp on a group row or
tombstone, written by a later statement in the same transaction. Hints carry no
origin in the model: a held hint may come from this client or a sibling client
of the same session.

Four negative controls independently break the contract and the invariants
fail. `SerializeAllocation = FALSE` allocates the cursor outside the head row
lock, as a database sequence would, so a later cursor can commit first and a
client can advance past the earlier one. `StampUnderHeadLock = FALSE` computes a
group stamp from a head read taken before the lock, so a concurrent writer can
commit that cursor first and the client skips the group change.
`ReleaseChecksCoverage = FALSE` drops held hints at release without a covering
pass. `CoverFromSend = FALSE` counts hints received while a pass was in flight
as covered by it, although its server read may predate their commits.

Lane contents, signed policy verification, authorization, and the cross-lane
consistency the client checks when it applies a page are outside the model.
Lost hints and failed passes are accepted staleness windows: the next hint,
reconnect, or explicit refresh retries. Runtime tests cover the SQL statements,
both database dialects, the response shapes, and the release decision.
