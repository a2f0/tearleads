# Attachment Retention

Status: accepted.

This note records the attachment/blob retention decision for the current
access-plane work in GitHub issue `#105`.

## Decision

Attachment/blob retention is live-only.

The server retains attachment blob bytes, blob access epochs, and blob
recipient envelopes only while at least one active `attachment_bindings` row
references that blob.

When `commit-change` retires an attachment binding through
`attachmentDetaches[]` or same-slot `attachmentCommits[]`:

- the old binding is marked detached during the atomic mutation
- if another active binding still references the old blob, the blob and its
  access material remain live
- if no active binding references the old blob, the server prunes the blob row,
  blob access epochs, blob recipient envelopes, and detached binding rows for
  that blob

Detached attachment bindings are transient replacement metadata. They are not a
historical attachment log, tombstone store, audit manifest, or recovery index.

## Product Semantics

The current design guarantees live note state and live attachment availability,
not durable attachment history.

Consequences:

- current note attachments remain downloadable while active bindings reference
  their blobs
- replacing or detaching an attachment can make the old blob bytes unavailable
  from the server once no active binding references them
- historical document updates may still contain encrypted metadata that once
  referenced an old attachment slot, but the system does not guarantee that the
  old blob bytes remain fetchable for historical replay
- retained clients may still have local blob bytes in their local cache, but
  that is not a server retention guarantee
- fresh-client bootstrap is expected to use the current live baseline and live
  attachments, not reconstruct every historical attachment version

## Why

Keeping detached blobs as "history" would create the appearance of durable audit
retention without the properties an audit feature needs.

Useful historical attachment retention needs a separate design for:

- retention period and deletion policy
- signed or hash-linked manifests
- tombstones for removed attachments
- how historical blob bytes are encrypted after access shrink
- whether retained-but-revoked users can keep reading old attachment versions
- how historical attachment records relate to document update history and
  baseline checkpoints

Those choices are larger than blob reachability GC and should not be smuggled
into the current design by keeping detached binding rows indefinitely.

## Non-Goals

This design does not provide:

- durable old attachment bytes after replacement or detach
- server-side historical attachment replay
- detached binding retention as an audit log
- signed attachment tombstones or manifests
- retroactive recovery of pruned blobs from the server

## Future Direction

If product requirements later need durable attachment history, implement it as a
separate audit/history layer rather than changing detached binding retention.

That future layer should align with
[document-rekey-and-audit-history.md](./document-rekey-and-audit-history.md):

- live sync remains compact
- audit/history records are append-only or tamper-evident
- baseline checkpoints commit to the history they include
- attachment history explicitly states whether old blob bytes, tombstones, or
  manifests are retained
