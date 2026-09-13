# Existing blob source authority

[`BlobSourceAuthority.tla`](./BlobSourceAuthority.tla) covers finding #13
of issue #2266. Write authority on a new attachment destination does not
authorize
reuse of arbitrary ciphertext already stored in the organization.

| Model action or predicate | Production seam |
| --- | --- |
| `Bind` / `CheckSourceAuthority` | `assertExistingBlobSourceAuthority` runs before installing the new binding |
| `sourceReadable` | `resolveReadableBlobAccess` checks current signed document/container access |
| `ciphertextAuthor` | `listBlobContentWriteHeaders` identifies the original verified ciphertext author |
| `destinationWritable` | `verifyAttachmentBindingEvent` verifies destination write authority |

The bounded model enumerates the three independent authority facts. It
abstracts signatures, membership and SQL lock acquisition. Production checks
run under the blob mutation and authorization locks, before the new binding
could authorize its own source. The ciphertext author retains source authority
for their own bytes, including
when an earlier binding is still attached or no longer readable. Readable source
bytes may be reused by other callers;
the signed destination mutation must still be authorized.

The negative control disables only source authority and demonstrates that a
destination writer could otherwise bind unreadable, unauthored ciphertext.
Runtime regression tests reproduce that case through the API transaction.
PostgreSQL lifecycle tests also cover revival and reclamation races.
