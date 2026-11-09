# Protocol Specification: Delete And Failure

Part of the [protocol specification](../protocol-specification.md).

## Delete And Purge Semantics

Removal is terminal and structural. Link, unlink, share, revoke, rekey, move,
and document purge carry signed access events; container delete is an
authenticated control-plane operation without a signed artifact.

`POST /documents/:documentId/purge` accepts a signed `document.purge` event. The
signature binds the current document manifest, the sole linked container, and
every manifest hash in the exact current root-to-leaf container path that
authorized the purge. The API independently verifies the event, exact heads,
root completeness, path contiguity, organization scope, and signer write access,
stores the terminal event, and then removes the document's mutable row, content
keys, encrypted updates, attachments, and live-head pointer. It retains the
signed document manifest chain and the exact signed authorization path plus its
verification dependencies so a device authorized through that purge-time path
can retrieve the [proof](../document-purge-verification.md) from
`GET /documents/:documentId/purge` after the live document is gone. A user whose
only access came through a path unlinked before the purge cannot retrieve it.

The proof carries redacted principal-policy snapshots for every group head its
container evidence references. Each snapshot retains the signed public state
chain and committed membership/grant projections, but no encrypted payload,
epoch-key row, or member envelope. Clients verify those signatures and
commitments before using historical group membership. Group deletion can
therefore erase recoverable server-side key material without making an earlier
terminal purge unverifiable.

Purge-path access permits a terminal snapshot. A caller's recorded observation
of a signed document head also permits full history; an explicit earlier
checkpoint requires that caller's observation of that exact head. History
includes cited public container/policy evidence, not keys. The SDK
authenticates before reading local pins (verified manifest checkpoints) and
verifies one response without refetching. Deletion requires an exact pin or
signed transitions from a pin or genesis. Missing history with no local
checkpoint defers deletion without an incident. A conflicting checkpoint
records an incident; snapshots cannot advance it. A newer path pin, ancestors
included, withholds deletion without incidents or retry loops: ancestry
cannot order the purge signature. The SDK commits the terminal purge
checkpoint in the same local SQLite transaction that removes the matching
document row and its side state. A stale local generation, identity
replacement, failed cleanup, or interruption rolls back both the checkpoint and
deletion so the verified proof can be retried safely. After a lost POST
response, a coded not-found retry uses the retained proof.

The API also requires that the document is linked to exactly one container (a
document with several links must first be unlinked down to one) and that the
target is not a container metadata document, which is torn down only with its
container. An unknown document id returns not found. Blobs referenced only by
the purged document are soft-deleted under the
[attachment retention](../attachment-retention.md) lifecycle: `dereferencedAt` is
stamped (an existing stamp keeps its original time) while bytes, objects, and
key material wait for the garbage-collection sweep, and a bind during the grace
period revives the blob. A blob still referenced by another active binding is
untouched; detached bindings do not keep a blob live. The response returns
`purgedAt`.

`DELETE /containers/:containerId` is an admin-only structural delete for empty,
non-system, non-root leaf containers. A root or system-slot container cannot be
deleted. Child containers or any linked user document make the delete a
conflict; the container's own metadata document, which every container links to
itself, is excluded from that guard. An unknown container id returns not found.
A successful delete runs in one transaction: it writes a per-recipient
`deleted` sync tombstone (the peer discovery signal), removes the container
row, then tears down its metadata document: the `containerMetadataDocuments`
binding and, when the composite create path materialized document rows, those
rows and any blobs they orphan (dereferenced after required row locks using the
database wall clock, so lock waits cannot consume the garbage-collection grace
period). The metadata document gets no purge tombstone because it is withheld
from client discovery; the container tombstone is the sole peer signal. Any
guard failure rolls the whole transaction back.

Trash is itself a system-slot container and so cannot be deleted or purged.
Sending an item to Trash is an ordinary signed relocation — never a delete — and
stays reversible. A document is relocated by replacing its link set (link Trash,
unlink its source containers); a container is relocated by re-parenting it under
Trash with `container.move`. The move workflow guards only the moved container's
own system slot, not the destination's, so a normal folder and its whole subtree
may be moved into Trash, and moved back out again to restore it. Terminal
removal is the separate, structural step:
`POST /documents/:documentId/purge` for a document and
`DELETE /containers/:containerId` for a folder — a non-empty folder is torn
down by a client-orchestrated cascade of those two primitives applied
leaf-first.

## Failure Semantics

The protocol is fail-closed:

- malformed route JSON returns validation errors
- stale manifest heads, stale key targets, and stale recipient keys return
  conflicts
- an unlink whose [rotation baseline](../glossary/keys.md#rotation-baseline)
  does not cover every committed update returns
  `409 document_unlink_rotation_baseline_stale`; the client proves the full
  history again and retries instead of resubmitting the refused snapshot
- missing signed policy material prevents managed-principal key derivation
- signer/session mismatches return forbidden
- unavailable policy, key, blob, or document material is an availability
  failure, not permission to bypass verification

[Projection tables](../glossary/sync.md#projection-row) are indexes and caches for
list and lookup performance, not authority for encryption targets or access
proofs.
