# Container deletion and terminal metadata IDs

[`ContainerDeletion.tla`](./ContainerDeletion.tla) models findings #4 and #17
in #2266. A document create and a leaf-container delete can start in either
order. A committed document must retain a live target, and deleting a container
must permanently retire its metadata document ID. The guarantee concerns
container deletion; billing purge of still-live containers is a separate
lifecycle outside this model. Retired ID pairs survive later organization purge.

| Model action or predicate | Production seam |
| --- | --- |
| `BeginCreate` | `lockCreateContainerPath` takes shared manifest-head locks |
| `CheckLiveContainer` | `loadLiveContainerOrganizations` requires a live row |
| `CommitCreate` | `insertDocumentAndLinks` commits the document and target links |
| `BeginDelete` | `deleteContainer` takes an exclusive manifest-head lock |
| `CommitDelete` / `RefuseNonemptyDelete` | `deleteLeafContainerRow` rejects nonempty containers |
| `PreserveMetadataReservation` | `teardownContainerMetadataDocument` retains the metadata binding |
| `BeginMetadataCreate` | `assertCreateCanAdvanceDocumentHead` rejects retired IDs |
| `SerializeMetadataLifecycle` | `lockDocumentLifecycleInTransaction` holds the stable document-ID lock |
| `CommitMetadataCreate` | `insertDocumentAndLinks` commits metadata creation |

The finite model contains one leaf, its metadata document, and one ordinary
document. A ready create holds the shared head lock until commit; a ready
delete holds the exclusive head lock through its emptiness check and teardown.
TLC explores both transaction orderings. Turning off the live-row check or
shared/exclusive serialization independently permits a document to commit into
a deleted container. Turning off the retained metadata reservation permits a
fresh history to reuse the retired ID. The metadata-create actor separately
checks its reservation and commits, through a different writable target whose
head lock does not overlap the deleted container. Removing its lifecycle lock
allows the check to pass before deletion and the stale create to commit after
retirement. All four are registered negative controls.

Each create actor and the delete actor runs once. An idle transition permits
stuttering in terminal states; this model checks safety, without a fairness or
liveness claim.

The implementation tests submit correctly signed requests through HTTP and
exercise both lock orderings against PostgreSQL. The model abstracts signature
verification, principal authorization, organization locking, and SQL isolation
below the shared/exclusive transaction locks. It does not model document purge,
container moves, arbitrary subtree deletion, or advisory-lock key hashing.
PostgreSQL regressions exercise ordinary and metadata creation in both lock
orderings, with the metadata create using another live target to isolate the
lifecycle lock from the container-head lock.
