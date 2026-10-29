# Attachment Retention

This document defines attachment/blob retention semantics for the access plane.

For shared protocol terminology, see [glossary.md](./glossary.md).

## Retention Model

Attachment/blob retention is live-only.

The server retains attachment blob bytes, blob content-key epochs, and blob
content-key target rows only while at least one active `attachment_bindings` row
references that blob, plus the garbage-collection grace period after the last
one is removed.

When a signed attachment mutation deactivates an attachment binding through
`attachment.detach` or a same-slot `attachment.bind` replacement:

- the old binding is marked detached during the atomic mutation
- if another active binding still references the old blob, the blob and its
  content-key material remain live
- if no active binding references the old blob, the same transaction stamps
  `blobs.dereferencedAt`, starting the garbage-collection grace period
- after the grace period, GC locks the blob and rechecks active reachability; a
  rebind revives it, otherwise GC prunes the blob row, blob content-key epochs,
  blob content-key target rows, write headers, and detached binding rows
- a failed live-state reclaim records `blobs.reclaimAttemptedAt`; maintenance
  reserves capacity for new work and retries without changing the original
  `dereferencedAt` lifecycle timestamp
- the blob registry (`blob_audit_objects`) permanently retains the blob
  generation's `organizationId`, so pruned ids remain concealed from every
  other organization
- pruning retains `blob_audit_objects.liveStorageKey` as durable
  physical-deletion work; maintenance records `objectDeleteAttemptedAt` before
  each try, reserves batch capacity for both new work and retries, and then
  clears the storage key and records `objectDeletedAt` after deletion succeeds
- object deletion or acknowledgement failures keep the durable row retryable
  and make the maintenance command fail after independent stage cleanup finishes

Detached attachment bindings are transient replacement metadata. They are not a
historical attachment log, tombstone store, history manifest, or recovery index.

## Product Semantics

The system guarantees live document state and live attachment availability, not
durable attachment history.

Consequences:

- current document attachments remain downloadable while active bindings
  reference their blobs
- replacing or detaching an attachment can make the old blob bytes unavailable
  from the API immediately once no active binding references them; physical
  object deletion follows after the GC grace period
- historical document updates may still contain encrypted metadata that once
  referenced an old attachment slot, but the system does not guarantee that the
  old blob bytes remain fetchable for historical replay
- retained clients may still have local blob bytes in their local cache, but
  that is not a server retention guarantee
- fresh-client bootstrap uses the current live baseline and live attachments,
  not every historical attachment version

## Rationale

Keeping detached blobs as "history" would create the appearance of durable audit
retention without the properties an audit feature needs.

Useful historical attachment retention requires deciding:

- retention period and deletion policy
- signed or hash-linked manifests
- tombstones for removed attachments
- whether retained-but-revoked users can keep reading old attachment versions
- how historical attachment records relate to document update history and
  baseline checkpoints

The container KEK keyring partly answers how historical blob bytes are keyed
after access shrink, and the consequence is container-wide: retained blob
ciphertext whose content key is wrapped under a recoverable old container KEK
is decryptable to every current member through the sealed keyring — access
shrink rotates keys forward, it does not re-encrypt or orphan history.
Pruned blob bytes remain unavailable for the opposite reason: the bytes no
longer exist, regardless of key reachability.

Those choices are larger than blob reachability GC, so detached binding rows are
not kept indefinitely as an implicit answer to them.

## Non-Goals

This retention model does not provide:

- durable old attachment bytes after replacement or detach
- server-side historical attachment replay
- detached binding retention as a history log
- signed attachment tombstones or manifests
- retroactive recovery of pruned blobs from the server

## Attachment History

The server keeps no separate attachment audit ledger. Each bind and detach is a
signed access event, persisted with its signed body in `access_events`, and each
staged blob carries a signed write header, so a binding's authorship stays
verifiable. Attach, replace, and detach register every referenced blob
generation in `blob_audit_objects` before live pruning can remove its row; the
registry records which generations existed and who owns them, not when they were
bound.

See [document-rekey-and-audit-history.md](./document-rekey-and-audit-history.md)
for what signed write headers do and do not detect.

## Operations

The API Worker's hourly Cron Trigger (`0 * * * *` in
[`packages/api/wrangler.jsonc`](../packages/api/wrangler.jsonc)) runs blob
maintenance through
[`packages/api/src/worker/maintenance.ts`](../packages/api/src/worker/maintenance.ts);
the trigger deploys with the Worker, so there is no separate timer to verify.
Each tier keeps its `BLOB_GC_HEALTHCHECK_URL` in
`.secrets/<tier>/healthchecks.env`; the API deploy refuses to run without an
`https` URL and syncs it as a Worker secret. Only the ping URL is deployed, not
a Healthchecks management API key.
[`packages/api/src/worker/healthchecks.ts`](../packages/api/src/worker/healthchecks.ts)
sends the start, success, and failure pings around each run. A run that throws
sends the failure signal; a missing success signal also detects a disabled
trigger or a terminated run. Healthchecks requests are best-effort, so an
unavailable monitoring provider cannot prevent reclamation, and they carry no
blob identifiers or application data.

A failed run is reported as a background failure to the API's error reporting
and rejects, so the Cron run is recorded as failed. Object-store cleanup
failures, including expired multipart stages, stay durable for a later run but
fail the current run rather than sending a false success ping.

To run the same maintenance on demand:

```sh
API_DATABASE=postgres bun packages/api/scripts/blobGc.ts [--grace-ms <n>] [--limit <n>]
```
