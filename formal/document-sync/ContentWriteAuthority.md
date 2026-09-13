# Content Write Authority

[ContentWriteAuthority.tla](./ContentWriteAuthority.tla) models findings 3 and 20
of #2266: a writer gains access after a child's original parent pin, writes,
and is later removed before the write reaches another device. Advancing the
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
attachment hydration run shares one refresh across its concurrent decryptions.

| Model action or predicate | Production seam |
| --- | --- |
| `CommitWrite` | `assertWriteHeaderPathCitations`, `resolveCurrentContainerManifestRefs` |
| `ReadWrite` | `documentWriteAuthorizationForHeader`, `resolveEventContainerPaths`, `resolveSubmittedDocumentSyncResult`, `createAttachmentDecryptor` |
| `ReadCurrentMembership` | `resolveHistoricalContainerPathUserAccessLevel` |
| `HonestWritesRemainReadable` | `verifyWriteHeader`, `verifyAttachmentBindingEvent` |
| `NewWritesUseCurrentAuthority` | `assertCurrentContainerPath` |

Four negative controls restore the pinned-parent fallback, authorize historical
writes with current membership, disable the API's current-path requirement, or
refuse a response using stale cached evidence without refreshing it.
Each must violate its named invariant. Hashes, signatures, exact sorted citation
sets, document/blob target coverage, and lineage validation are abstracted as
verified inputs here; runtime tests cover their concrete checks. This model does
not prove semantic currency against a dishonest server or prevent a removed
signer and server from supplying a previously valid historical authorization.
