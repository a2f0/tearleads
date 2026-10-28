# Content Write Authority

[ContentWriteAuthority.tla](./ContentWriteAuthority.tla) models a writer that
gains access after a child's original parent pin, writes, and is later removed
before the write reaches another device. Advancing the
leaf must not replace the signed write-time path with that original pin.
A current group snapshot must not replace the membership cited by the write.

The bounded configuration has three parent heads, two leaf heads, one writer,
and writes carrying their cited parent, leaf, and server head at commit. The
parent manifests separate grant presence from the referenced group version;
group version 0 contains the writer and version 1 removes it. Parent 1 adds
the grant; parent 2 advances the group reference after removal. TLC explores
all grant, write, leaf advancement, removal, and delayed read interleavings.
The reader can initially hold only the pre-grant proof. A read missing its
cited ancestor refreshes the served history before it verifies the frozen
response. Honest fresh projections include all retained cited heads; a second
missing dependency after the one runtime refresh still fails verification.
This applies to submitted document responses and attachment ciphertext. An
attachment hydration or key-rewrap run shares one refresh across its decryptions.

The document is also linked into a second container. A second reader opens it
only through that link and starts with none of the leaf's history, so it must
be served the leaf path that every write through the leaf cites. The document
may later be unlinked from the leaf, after which the empty leaf may be
deleted; readers on the other link must still verify the writes made through
it. `CitedHeadsReachEveryReader` states that every reader who can open the
document is served every committed write's cited head.

| Model action or predicate | Production seam |
| --- | --- |
| `CommitWrite` | `assertWriteHeaderPathCitations`, `resolveCurrentContainerManifestRefs` |
| `CheckWriteAuthority` / `CommittedWritesAreAuthorized` | `requireWriteAccessThroughCommittedDocumentTarget` and `requireWriteAccessThroughCommittedBlobTarget` refuse a write the cited path does not authorize |
| `ReadWrite` | `documentWriteAuthorizationForHeader`, `resolveEventContainerPaths`, `resolveSubmittedDocumentSyncResult`, `createAttachmentProofReader` |
| `ReadCurrentMembership` | `resolveHistoricalContainerPathUserAccessLevel` |
| `HonestWritesRemainReadable` | `verifyWriteHeader`, `verifyAttachmentBindingEvent` |
| `NewWritesUseCurrentAuthority` | `assertCurrentContainerPath` |
| `Served` / `ServeEveryWriteDependency` / `CitedHeadsReachEveryReader` | `loadDocumentWriterProjectionVerificationMaterial` adds every hash `listDocumentContentWriteDependencyHashes` reads from the document's and its attachments' write headers, with no filter by the requester's own links, and loads each path with its predecessors and citations; `verifyDocumentWriterProjection` verifies those paths at their referenced membership |
| `Unlink` | `mutateDocumentLinkSet` removes the leaf from the document's link set |
| `DeleteLeaf` / `RetainManifestsOnDelete` | `deleteLeafContainerRow` refuses a container with a linked user document; `deleteContainer` removes the container row and its metadata document but keeps the container's `accessManifests` rows, which only an organization purge (`deleteOrganizationRemoteRows`) deletes |

A write may cite any head, including one that does not authorize the writer,
as a revoked writer can still submit; the API commits only an authorized one
(`CommittedWritesAreAuthorized`). Seven negative controls read through the
original parent pin, authorize historical writes with current membership,
disable the API's current-path requirement, commit a write its cited path does
not authorize, refuse a response using stale cached evidence without
refreshing it, filter the projection to the reader's own links, or delete a
container's manifests with it. Each must violate its named invariant; either
of the last two also makes the reader on the other link refuse an honest
write. The registered run explores 726 generated and 174 distinct states.
Hashes, signatures, exact sorted citation sets, document/blob target coverage,
and lineage validation are abstracted as verified inputs here; runtime tests
cover their concrete checks.
This model does not prove semantic currency against a dishonest server or
prevent a removed signer and server from supplying a previously valid historical
authorization.
