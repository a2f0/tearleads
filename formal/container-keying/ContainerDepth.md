# Container depth remains readable

[`ContainerDepth.tla`](./ContainerDepth.tla) checks that a create or subtree
move preserves the path bound used by readers. Depth counts
edges from the root; the production limit counts containers, so a 100-container
path has depths zero through 99.

| Model action or predicate | Production seam |
| --- | --- |
| `Create` / `GuardCreateDepth` | `persistCreatedContainerStructure` checks `assertContainerDepth` before insertion |
| `Move` / `GuardMoveDepth` | `persistContainerStructure` checks the destination in `assertContainerMoveDepth` |
| `Subtree` / `GuardSubtreeDepth` | `assertContainerMoveDepth` walks descendants and checks the deepest resulting depth |
| `HonestReadsAvailable` | `MAX_CONTAINER_PATH_LENGTH` bounds `loadContainerAccessPath` and `assertContainerChildPathFits` |
| `CommitMax` / `ApiReadMax` / `ClientReadMax` | the one shared `MAX_CONTAINER_PATH_LENGTH`: `assertContainerDepth` for commits, `loadContainerPath` for API path reads, `assertContainerPathLengthFits` for client reads |
| `GuardMoveCycle` / `PathsReachRoot` | `deriveContainerMoveManifestState` refuses a destination parent path containing the moved container |

The bounded configuration explores five nodes and paths of up to three
containers, including moves where the moved root fits but a descendant does
not. Removing each of the create, move-root, and moved-descendant guards
independently violates `HonestReadsAvailable`; all three controls are registered.
`DepthMatchesParents` checks that moves update every descendant's depth.

Writers and readers bound paths separately in the model. Production shares
one constant, so the registered configuration sets the commit bound and both
reader bounds equal; a reader bound below the commit bound, the shape of an
earlier finding, is a registered control that violates `HonestReadsAvailable`
for the client reader. Ancestor walks are bounded by the node count, so the
model can also drop the move cycle guard: `GuardMoveCycle = FALSE` moves a
container under its own descendant and violates `PathsReachRoot`.

Structural mutations are atomic, corresponding to the API's organization-locked
transaction. This model does not establish SQL lock behavior, cryptographic
verification, authorization, or arbitrary-size correctness. Real API tests
create a correctly signed 100-container chain and exercise create, leaf move,
subtree move, and the exact valid boundary on SQLite and PGlite. SDK tests check
early destination refusal; the API must check descendants that a client may not
be able to discover.

This model covers structural create and move transitions only. Production
revocations do not change structure and do not call the depth guards;
revocation availability and carried-rekey obligations are outside this model.
It establishes no temporal liveness result.
