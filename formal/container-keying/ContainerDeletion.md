# Container deletion and terminal metadata IDs

[`ContainerDeletion.tla`](./ContainerDeletion.tla) models findings #4 and #17
in #2266. A document create and a leaf-container delete can start in either
order. A committed document must retain a live target, and deleting a container
must permanently retire its metadata document ID.

| Model action or predicate | Production seam |
| --- | --- |
| `BeginCreate` | `lockCreateContainerPath` takes shared manifest-head locks |
| `CheckLiveContainer` | `loadLiveContainerOrganizations` requires a live row |
| `CommitCreate` | `insertDocumentAndLinks` commits the document and target links |
| `BeginDelete` | `deleteContainer` takes an exclusive manifest-head lock |
| `CommitDelete` / `RefuseNonemptyDelete` | `deleteLeafContainerRow` rejects nonempty containers |
| `PreserveMetadataReservation` | `teardownContainerMetadataDocument` retains the metadata binding (lifecycle-lock mechanics abstracted below) |
| `ReuseMetadataId` | `assertCreateCanAdvanceDocumentHead` and `assertMetadataDocumentAvailable` reject retired IDs (lifecycle-lock mechanics abstracted below) |

The finite model contains one leaf, its metadata document, and one ordinary
document. A ready create holds the shared head lock until commit; a ready
delete holds the exclusive head lock through its emptiness check and teardown.
TLC explores both transaction orderings. Turning off the live-row check or
shared/exclusive serialization independently permits a document to commit into
a deleted container. Turning off the retained metadata reservation permits a
fresh history to reuse the retired ID. All three are registered negative
controls.

The actors each run once. An idle transition permits stuttering in terminal
states; this model checks safety, without a fairness or liveness claim.

The implementation tests submit correctly signed requests through HTTP and
exercise both lock orderings against PostgreSQL. The model abstracts signature
verification, principal authorization, organization locking, and SQL isolation
below the shared/exclusive transaction locks. It does not model document purge,
container moves, arbitrary subtree deletion, or lifecycle-lock implementation;
the existing PostgreSQL concurrency suite exercises the wider lock order.
