# Container listing removals and recovery

[`ContainerTombstoneRecovery.tla`](./ContainerTombstoneRecovery.tla) covers
finding 8 of #2365. A parent listing
can withdraw a cached subtree after its child has moved elsewhere. The listing
is unsigned, including its deletion reason and timestamp. It cannot authorize
erasing local work or declaring every cached descendant terminally deleted.

| Model action or predicate | Production seam |
| --- | --- |
| `ObserveHint` | `applyContainerTombstones`, `deleteStoredContainers` quarantine listings while retaining metadata and structural intents |
| `LateProofNeverRestores` | `recordContainerHydrationTombstones` fences every removed descendant; an earlier fetch cannot make it visible |
| `Fetch` | `fetchContainerParentLaneBatch`, `verifyRemoteContainerDestination` observe local generations before verifying restoration evidence |
| `Restore` / `LateProofNeverRestores` | `commitStoredHydratedContainer` compares the observed generation and metadata before committing |
| `LocalWorkSurvives` | `completeRestorationSweeps` retains unavailable metadata instead of purging it from an unsigned 404 |

The bound contains a parent, a child, three kinds of local work, and two
removal generations. A second device can move the child and delete its old
parent. A dishonest server can also invent a removal while both remain live.
A fresh verified response has an older server clock than the removal hint.
Independent removal and request revisions track what becomes visible. The moved
child can recover after its old parent is deleted. Four negative controls erase
local work, omit descendant fences, trust unsigned clocks,
or ignore a concurrent generation change, respectively.

The model abstracts signatures, database transactions, metadata records, and
individual intent bytes. Runtime tests cover those boundaries, persistence
across reloads, and canonical timestamp parsing. Recovery is enabled after
verified live evidence; no guarantee is made that a dishonest server supplies
that evidence. Explicit user deletion remains a separate authorized operation.
