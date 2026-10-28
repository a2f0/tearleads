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

| Model action or predicate | Production seam |
| --- | --- |
| `CommitWrite` | `assertWriteHeaderPathCitations`, `resolveCurrentContainerManifestRefs` |
| `CheckWriteAuthority` / `CommittedWritesAreAuthorized` | `requireWriteAccessThroughCommittedDocumentTarget` and `requireWriteAccessThroughCommittedBlobTarget` refuse a write the cited path does not authorize |
| `ReadWrite` | `documentWriteAuthorizationForHeader`, `resolveEventContainerPaths`, `resolveSubmittedDocumentSyncResult`, `createAttachmentProofReader` |
| `ReadCurrentMembership` | `resolveHistoricalContainerPathUserAccessLevel` |
| `HonestWritesRemainReadable` | `verifyWriteHeader`, `verifyAttachmentBindingEvent` |
| `NewWritesUseCurrentAuthority` | `assertCurrentContainerPath` |

A write may cite any head, including one that does not authorize the writer,
as a revoked writer can still submit; the API commits only an authorized one
(`CommittedWritesAreAuthorized`). Five negative controls read through the
original parent pin, authorize historical writes with current membership,
disable the API's current-path requirement, commit a write its cited path does
not authorize, or refuse a response using stale cached evidence without
refreshing it. Each must violate its named invariant. Hashes, signatures, exact sorted
citation sets, document/blob target coverage, and lineage validation are
abstracted as verified inputs here; runtime tests cover their concrete checks.
This model does not prove semantic currency against a dishonest server or
prevent a removed signer and server from supplying a previously valid historical
authorization.
