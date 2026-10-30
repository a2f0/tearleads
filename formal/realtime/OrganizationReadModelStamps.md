# Organization Read-Model Stamps

[`OrganizationReadModelStamps.tla`](./OrganizationReadModelStamps.tla) models
the organization read-model cursor: each source mutation advances the
per-organization head and stamps every lane or group it changed with the new
cursor, and a delta from cursor `c` reloads exactly the entities whose stamp
exceeds `c`. See the
[ordering and replay contract](../../docs/organization-read-model-sync.md#ordering-and-replay).

| Model action or predicate | Production seam |
| --- | --- |
| `Begin` | A mutation writes uncommitted domain rows (group row, tombstone, roster, policy) before `appendOrganizationReadModelChangeInTransaction` |
| `AdvanceHead` | `advanceOrganizationReadModelHead` increments the cursor and stamps head-row lanes in one update that holds the head row lock until commit |
| `GroupStamp` | `stampGroupMembershipChanges` stamps group rows and tombstones with the cursor that update returned |
| `Commit` / `Abort` | `appendOrganizationReadModelChangeInTransaction` runs in the source mutation's transaction, which commits or rolls back its domain rows, head, and stamps together |
| `Reconcile` | `lockOrganizationReadModelHeadInTransaction` reads the head and lane stamps under the shared lock, `loadDeltaResponse` reloads every lane stamped after the cursor (the organization-policy lane serves the head `requireDirectOrganizationAccess` verified under that lock), and `applyOrganizationReadModelResponse` applies the page and cursor atomically |
| `CursorCoversChanges` | `loadDeltaResponse` never lets `applyOrganizationReadModelResponse` adopt a cursor that covers a change the page did not carry |
| `CaughtUpClientIsCurrent` | After `applyOrganizationReadModelResponse` adopts the head cursor, the local projection equals the server's current lanes |
| `Begin` with `promotes` / `StampDirectoryOnAdminsChange` | `appendPolicyReadModelChanges` stamps the `directory` lane when `isOrganizationAdminsGroup` names the changed group |
| `admin` / `seenAdmin` / `CaughtUpDirectoryMatchesRole` | `loadOrganizationDirectoryInTransaction` serves pending leave requests only to administrators and the member, so a reader's directory depends on its role at the time of the read |

Bounds are two writers and one client. Each writer changes the head-row lane,
the group row, or both, and may roll back at any point. The client reconciles
at arbitrary times, standing in for hints that arrive, coalesce, or are lost.
The `directory` entity stands for every lane stamped on the head row, since all
of them are written by the same update; `group` stands for a membership stamp
on a group row or tombstone, written by a later statement in the same
transaction.

Three negative controls each break one rule. Two break the concurrency
contract. `SerializeAllocation = FALSE` allocates the cursor outside the
head row lock, as a database sequence would, so a later cursor can commit first
and a client can advance past the earlier one. `StampUnderHeadLock = FALSE`
computes a group stamp from a head read taken before the lock, so a concurrent
writer can commit that cursor first and the client skips the group change.

The directory lane's content also depends on who reads it: pending leave
requests reach only administrators. A mutation may be an Admins change that
flips the reader's role. That changes what the reader's directory should hold
without any directory row changing, so the change stamps the directory as well,
and a caught-up reader holds a directory served under its current role
(`CaughtUpDirectoryMatchesRole`). `StampDirectoryOnAdminsChange = FALSE`
stamps only the group row, and a newly promoted administrator catches up while
still holding the member's view.

Lane contents, signed policy verification, authorization, and the cross-lane
consistency the client checks when it applies a page are outside the model. The
shared head lock is modeled as making `Reconcile` atomic; runtime tests cover
the SQL statements, both database dialects, and the response shapes.
