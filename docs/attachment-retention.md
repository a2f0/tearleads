# Attachment Retention

This document defines attachment/blob retention semantics for the access plane.

For shared protocol terminology, see [glossary.md](./glossary.md).

## Retention Model

Attachment/blob retention is live-only.

The server retains attachment blob bytes, blob content-key epochs, and blob
content-key target rows only while at least one active `attachment_bindings` row
references that blob.

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
- audit metadata permanently retains the blob generation's `organizationId`,
 so pruned ids remain concealed from every other organization
- pruning retains `blob_audit_objects.liveStorageKey` as durable physical-
 deletion work; maintenance records `objectDeleteAttemptedAt` before each try,
 reserves batch capacity for both new work and retries, and then clears the
 storage key
 and records `objectDeletedAt` after deletion succeeds
- object deletion or acknowledgement failures keep the durable row retryable
 and make the maintenance command fail after independent stage cleanup finishes

Detached attachment bindings are transient replacement metadata. They are not a
historical attachment log, tombstone store, audit manifest, or recovery index.

This is a clean-break schema contract. The migration intentionally does not
infer `dereferencedAt` for attachment rows created by an older deployment; the
greenfield rollout starts with the lifecycle fields present.

## Product Semantics

The system guarantees live document state and live attachment availability, not
durable attachment history.

Consequences:

- current document attachments remain downloadable while active bindings reference
 their blobs
- replacing or detaching an attachment can make the old blob bytes unavailable
 from the API immediately once no active binding references them; physical
 object deletion follows after the GC grace period
- historical document updates may still contain encrypted metadata that once
 referenced an old attachment slot, but the system does not guarantee that the
 old blob bytes remain fetchable for historical replay
- retained clients may still have local blob bytes in their local cache, but
 that is not a server retention guarantee
- fresh-client bootstrap is expected to use the current live baseline and live
 attachments, not reconstruct every historical attachment version

## Rationale

Keeping detached blobs as "history" would create the appearance of durable audit
retention without the properties an audit feature needs.

Useful historical attachment retention needs a separate design for:

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

Those choices are larger than blob reachability GC and should not be introduced
implicitly by keeping detached binding rows indefinitely.

## Non-Goals

This retention model does not provide:

- durable old attachment bytes after replacement or detach
- server-side historical attachment replay
- detached binding retention as an audit log
- signed attachment tombstones or manifests
- retroactive recovery of pruned blobs from the server

## Separate Audit Layer

Durable attachment history requires a separate audit/history layer rather than
changes to detached binding retention.

That audit/history layer should align with
[document-rekey-and-audit-history.md](./document-rekey-and-audit-history.md):

- live sync remains compact
- audit/history records are append-only and tamper-evident
- baseline checkpoints commit to the history they include
- attachment history explicitly states whether old blob bytes, tombstones, or
 manifests are retained

The audit/history schema and verifier exist, and normal signed attachment
mutations append attachment audit rows before live blob pruning can remove
metadata needed by `blob_audit_objects`.

## Operations

Ansible installs `tearleads-blob-gc.service` and its persistent hourly timer.
Provisioning fails unless the timer reports both `enabled` and `active`, and
each API deployment repeats those checks after restarting the maintenance
units. Each tier loads its secret `BLOB_GC_HEALTHCHECK_URL` from
`.secrets/<tier>.healthchecks.env`; the project management API key is not
deployed. The service sends Healthchecks start and success signals, while timer
or service failure sends a failure signal through
`tearleads-maintenance-alert@.service`. Missing success signals also detect a
disabled timer, unreachable host, or terminated run. Healthchecks requests are
best-effort so an unavailable monitoring provider cannot prevent reclamation,
and carry no blob identifiers or application data. A local helper passes the
secret ping endpoint to curl over standard input so it is not exposed in the
process command line.

The failure service also writes a local `daemon.alert` journal entry tagged
`tearleads-maintenance-alert` with the failed unit name. Object-store cleanup
failures remain durable for a later retry, including expired multipart stages,
but make the current maintenance run fail rather than emitting a false success
heartbeat. A missing GC executable is likewise a visible service failure rather
than a silently skipped run.

Check the schedule, the last collection result, and failure alerts with:

```sh
sudo systemctl status tearleads-blob-gc.timer
sudo systemctl status tearleads-blob-gc.service
sudo journalctl -u tearleads-blob-gc.service
sudo journalctl -t tearleads-maintenance-alert
```
