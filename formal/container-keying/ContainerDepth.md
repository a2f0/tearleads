# Container depth remains readable

[`ContainerDepth.tla`](./ContainerDepth.tla) models #2365 finding #12: a create
or subtree move must preserve the path bound used by readers. Depth counts
edges from the root; the production limit counts containers, so a 100-container
path has depths zero through 99.

| Model action or predicate | Production seam |
| --- | --- |
| `Create` / `GuardCreateDepth` | `persistCreatedContainerStructure` checks `assertContainerDepth` before insertion |
| `Move` / `GuardMoveDepth` | `persistContainerStructure` checks the destination in `assertContainerMoveDepth` |
| `Subtree` / `GuardSubtreeDepth` | `assertContainerMoveDepth` walks descendants and checks the deepest resulting depth |
| `HonestReadsAvailable` | `MAX_CONTAINER_PATH_LENGTH` bounds `loadContainerAccessPath` and `assertContainerChildPathFits` |
| `Revoke` / `RevocationAvailable` | `touchContainerStructure` preserves structure during policy rotation |

The bounded configuration explores five nodes and paths of up to three
containers, including moves where the moved root fits but a descendant does
not. Removing each of the create, move-root, and moved-descendant guards
independently violates `HonestReadsAvailable`; all three controls are registered.
`DepthMatchesParents` checks that moves update every descendant's depth.

Structural mutations are atomic, corresponding to the API's organization-locked
transaction. This model does not establish SQL lock behavior, cryptographic
verification, authorization, or arbitrary-size correctness. Real API tests
create a correctly signed 100-container chain and exercise create, leaf move,
subtree move, and the exact valid boundary on SQLite and PGlite. SDK tests check
early destination refusal; the API must check descendants that a client may not
be able to discover.

Revocation does not change structure and remains enabled regardless of depth.
This is an enabled-action check, not a temporal liveness proof; carried-rekey
obligations and their independent resource limits belong to the other keying
models. No migration or compatibility behavior is modeled or implemented.
