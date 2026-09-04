# Restart Probe Convergence Mapping

[`RestartProbeConvergence.tla`](./RestartProbeConvergence.tla) models catch-up
for an opened, persisted remote document across process restart and an iOS
server-events disconnect. Remote and local body versions and attachment-slot
metadata versions represent encrypted Loro state. Attachment bindings, blob
bytes, and hydration are outside this model.

Restart destroys queued and in-flight process-local work; reopening the row arms
a startup HTTP probe. A retained disconnect preserves work already accepted by
the document store, while peer hints emitted during the disconnected interval
may be missed.

Raw socket open and `interest_state` do not establish readiness. The model waits
for a ready container tree, sends an authoritative `known_containers`
declaration covering the document, and accepts only its matching acknowledgement.
That acknowledgement proves the server installed the interest before the SDK
increments its connection generation and queues a reconnect probe. Peer writes
may occur while stopped, before the tree or acknowledgement, or while a probe is
in flight. The acknowledgement captures the body and slot targets that gap
recovery must cover.

A probe has separate begin and finish actions. Begin consumes the coalesced
queued bit and captures one server snapshot. A delivered peer hint or matching
acknowledgement arriving in flight queues newer work. Finish applies only the
captured versions and cannot clear that newer request; a fair follow-up probe
must cover its target. This abstracts the runtime remote-update signal sequence.

| Model action | Production seam |
| --- | --- |
| `RemoteBodyAdvance` | peer `document_update_created` commit, whether or not its websocket hint arrives |
| `RemoteSlotAdvance` | peer Loro update changing attachment-slot metadata and emitting the ordinary lossy invalidation (`document_update_created`) |
| `Restart` | document-store and in-memory event teardown across process restart, re-entered through `initializeDocumentStore` on the next load |
| `InitializeOpenedPersistedDocument` | `initializeDocumentStore` arming `remoteUpdatePending` for a loaded remote record |
| `DisconnectEvents` | server-events disconnect (`setConnected` drops the connected flag) while retaining accepted document work |
| `ReceiveInterestBaseline` | `interest_state` starting restoration without marking events connected |
| `MarkContainerTreeReady` | the `containerStore` snapshot publishing its ready, hydrated node set |
| `DeclareKnownContainers` | authoritative current set sent by `startContainerInterestDeclaration` with a fresh declaration id |
| `AcknowledgeKnownContainers` | matching `known_containers_ack` proving coverage, advancing the connection generation, and requesting revalidation |
| `BeginProbe` | document lane captures `remoteUpdateSignalSeq` and starts `requestRemoteDocumentSync` |
| `FinishProbe` | captured updates are applied and persisted; `canClearRemoteUpdateSignalAfterSync` preserves a newer sequence |

Weak fairness requires initialization, tree readiness, baseline/declaration/ack
restoration, and continuously enabled probe actions to run. TLC checks that a
raw baseline cannot arm reconnect, declaration requires a ready tree, ack proves
coverage before the reconnect request, begin captures one body-plus-slot
snapshot, and finish preserves newer work. Every accepted request eventually
covers its recorded target, and restart/reconnect recovery covers the versions
observed at its acknowledgement barrier.

The bounded configuration uses versions zero and one, at most one restart, and
at most one retained-process disconnect. TLC explores 6,757 generated states,
1,912 distinct states, and depth 15. The document is assumed to remain opened,
persisted, authorized, and present in the authoritative tree; a matching ack and
an armed probe eventually succeed. A dropped hint after acknowledged readiness
may remain stale until a later recovery trigger. Unopened-document policy,
HTTP failure/backoff, encrypted payload integrity, attachment binding/blob
hydration, SQLite transactionality, and Loro merge correctness are out of scope.

## Implementation trace projection

`bun run check:protocol-projection` (part of `check:fast`) replays recorded
implementation runs through this model. Two scenario tests drive the real
seams with fault injection and record each run as a sequence of the model's
actions:

- `packages/client-sdk/src/stores/documents/documentStore/restartProbeProjection.test.ts`
  drives the probe-signal kernels (`handleDocumentRemoteEvents`,
  `clearConsumedRemoteUpdateSignal`, the arming helpers) through delivered and
  echoed hints, a mid-flight hint, a restart, and the post-ack revalidation,
  recording the implementation-projected `probeRequested` bit after each step.
- `packages/app/src/providers/sdk/restartProbeProjection.test.ts` drives the
  interest-barrier seams (`routeIncomingWsMessage`,
  `startContainerInterestDeclaration`) through a disconnect, reconnect
  baseline, authoritative declaration, a stale-acknowledgement refusal, and
  the matching acknowledgement, recording the observed frame ordering.

The check generates a TLC module per trace whose next-state relation conjoins
the model's own action (and the recorded observation bits) for each step; a
sequence or projected bit the model rejects deadlocks TLC and fails the check.
Two negative controls run every time — a dropped declaration and a flipped
settled-probe observation — so the oracle cannot silently go vacuous.
Boundaries: the probe scenario scripts the interest-side transitions (the app
scenario records them from its own seams), the restart re-initialization and
post-acknowledgement revalidation arming calls are scripted to mirror
`initializeDocumentStore` and the reconnect wiring (the kernels then own the
armed signal), and each trace validates one recorded interleaving, not the
full state space — the registered bounded model run remains the exploration.
