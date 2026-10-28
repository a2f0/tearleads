# Existing blob source authority

[`BlobSourceAuthority.tla`](./BlobSourceAuthority.tla) checks that write
authority on a new attachment destination does not authorize reuse of arbitrary
ciphertext already stored in the organization.

| Model action or predicate | Production seam |
| --- | --- |
| `Bind` / `CheckSourceAuthority` | `assertExistingBlobSourceAuthority` runs before installing the new binding |
| `sourceReadable` | `resolveReadableBlobAccess` checks current signed document/container access |
| `ciphertextAuthor` | `listBlobContentWriteHeaders` identifies the original verified ciphertext author |
| `destinationWritable` / `CheckDestinationWrite` | `verifyAttachmentBindingEvent` verifies destination write authority |

The bounded model enumerates the three independent authority facts. It
abstracts signatures, membership and SQL lock acquisition. Production checks
run under the blob mutation and authorization locks, before the new binding
could authorize its own source. The ciphertext author retains source authority
for their own bytes, including when an earlier binding is still attached or no
longer readable. Other callers may reuse readable source bytes; the signed
destination mutation must still be authorized.

A bind request may come from any reader, so both authority checks are
parameters. One negative control disables only source authority and
demonstrates that a destination writer could otherwise bind unreadable,
unauthored ciphertext; the other disables the destination check, and a reader
without write access binds into the destination.
Runtime regression tests reproduce that case through the API transaction.
PostgreSQL lifecycle tests also cover revival and reclamation races.
