# Glossary: Sync And Server State

Part of the [glossary](../glossary.md).

## Checkpoint

A client's durable, monotonic local record of the newest verified signed
[head](#head) it has accepted for an object or principal, used to refuse
rollback. Production keeps a principal policy checkpoint (`principalType`,
`principalId`, `version`, `stateHash`) and an
[access manifest](./access.md#access-manifest) checkpoint (`objectKind`, `organizationId`,
`objectId`, `epoch`, `manifestHash`). A served head below the checkpoint is
rollback, the same version or epoch with a different hash is equivocation, and
a newer head is accepted only when its signed chain extends the checkpoint. An
[identity pin](./principals.md#identity-pin) is separate: it fixes one user's
exact keys rather than tracking advancing signed state, and backup restore
merges both monotonically. The word also names unrelated objects: local document-history
Loro snapshots, a [rotation baseline](./keys.md#rotation-baseline)'s `checkpointKind`,
and transparency tree checkpoints.

Related docs:

- [keying-design.md](../keying-design/verification.md#transparency-and-checkpointing)
- [security-guarantees.md](../security-guarantees/boundaries.md#rollback-and-split-view)
- [trusted-user-identity.md](../developer/trusted-user-identity.md#scope-and-lifecycle)

## Commit LSN

The Postgres WAL log sequence number returned by sync responses after accepted
writes or read-only observations. Clients can use it as a consistency hook for
replica-safe read-after-write behavior.

Related docs:

- [loro-e2ee-sync-protocol.md](../loro-e2ee-sync-protocol.md#protocol-shape)

## Head

The current signed state of an access-controlled object or a
[managed principal](./principals.md#managed-principal): the newest
[access manifest](./access.md#access-manifest) of a container or a document link
set, or the newest state of a
[principal policy chain](./principals.md#principal-policy-state). The API stores
one current access head per object in `access_manifest_heads`, keyed by object
kind and id and naming its manifest hash and epoch; a principal head is
identified by its `version` and `stateHash`. Container mutations cite the heads
they depend on, and the API refuses a stale or uncited head at commit. Clients
accept a newer head only when it extends their local [checkpoint](#checkpoint).
A transparency log's signed tree head is a different object.

Related docs:

- [access-plane.md](../access-plane.md#authority)
- [keying-design.md](../keying-design/access-manifests.md#container-access-manifests)
- [protocol-specification.md](../protocol-specification/container-access.md#container-access-and-kek-protocol)
- [security-guarantees.md](../security-guarantees/properties.md#held-descendant-re-citation)

## Projection Row

A relational index or cache derived from signed protocol state. Projection rows
help list, lookup, and sync performance, but clients must not treat them as
authorization authority by themselves.

Related docs:

- [access-plane.md](../access-plane.md#authority)
- [security-guarantees.md](../security-guarantees/boundaries.md#projection-rows-are-not-a-security-boundary)

## Realtime Hint

A best-effort, content-free WebSocket notification published after a committed
mutation that asks clients to refresh over HTTP. Hints establish neither
content nor access: the gateway routes each one only to sockets whose declared
`known_containers` interest it has verified, and later HTTP reconciliation
remains authoritative. A publication failure never changes the successful
mutation's result. Because hints are volatile and do not survive process
restart or a dropped socket, the client arms revalidation probes at startup and
after each acknowledged reconnect. The
[organization read model](./principals.md#organization-read-model) uses the same
kind of hint for declared `known_organizations` interest.

Related docs:

- [realtime-hints.md](../developer/realtime-hints.md)
- [client-sync-ordering.md](../client-sync-ordering.md#remote-pull-eligibility)
- [organization-read-model-sync.md](../organization-read-model-sync.md#realtime-behavior)

## Sync Lane

A named unit of queued client sync work scheduled by the SDK's sync
coordinator, one per `DomainScope`. The structural `container-contents` lane
drains before any document lane, and each [document](./content.md#document)
store owns a `documents:${localId}` lane that also performs its blob attachment
work; up to four document lanes run concurrently. The coordinator is
non-preemptive, and a lane exceeding its watchdog is abandoned, not cancelled,
while its run token prevents same-lane overlap. Container listing requests and the
[organization read model](./principals.md#organization-read-model) also say
"lane" for a per-container listing page or a cursor-stamped read-model section;
those are request and feed units, not coordinator lanes.

Related docs:

- [client-sync-ordering.md](../client-sync-ordering.md)
- [client-sync-ordering.md](../client-sync-ordering.md#document-phase)
- [device-first.md](../developer/device-first.md#layer-b--reconciliationservice)

## Writer Projection

A server response that packages an object's signed access history, wrapped key
material, and [key targets](./keys.md#key-target) so a client can unwrap its
keys and prepare writes. Serving one requires current read access; write
authorization is checked when a write commits.

Related docs:

- [access-plane.md](../access-plane.md#containers)
- [api-architecture.md](../api-architecture.md#http-protocol-surface)
