# Content Write Authority

[ContentWriteAuthority.tla](./ContentWriteAuthority.tla) models findings 3 and 20
of #2266: a writer gains access after a child's original parent pin, writes,
and is later removed before the write reaches another device. Advancing the
leaf must not replace the signed write-time path with that original pin.
A current group snapshot must not replace the membership cited by the write.

The bounded configuration has three parent heads, two leaf heads, one writer,
and a set of writes identified by their cited parent and leaf. Parent 1 grants
write; parent 2 removes it and rematerializes the group reference. TLC explores
all grant, write, leaf advancement, removal, and delayed read interleavings.

| Model action or predicate | Production seam |
| --- | --- |
| `CommitWrite` | `assertWriteHeaderPathCitations`, `resolveCurrentContainerManifestRefs` |
| `ReadWrite` | `documentWriteAuthorizationForHeader`, `resolveEventContainerPaths` |
| `ReadCurrentMembership` | `resolveHistoricalContainerPathUserAccessLevel` |
| `HonestWritesRemainReadable` | `verifyWriteHeader`, `verifyAttachmentBindingEvent` |
| `NewWritesUseCurrentAuthority` | `assertCurrentContainerPath` |

Three negative controls restore the pinned-parent fallback, authorize historical
writes with current membership, or disable the API's current-path requirement.
Each must violate its named invariant. Hashes, signatures, exact sorted citation
sets, document/blob target coverage, and lineage validation are abstracted as
verified inputs here; runtime tests cover their concrete checks. This model does
not prove semantic currency against a dishonest server or prevent a removed
signer and server from supplying a previously valid historical authorization.
