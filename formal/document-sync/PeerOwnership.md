# Document Peer Ownership

[`PeerOwnership.tla`](./PeerOwnership.tla) models the server's peer-ownership
rule for document sync (#3194, part B1b), which closes
[preempted operations](../../docs/peer-ownership.md), and how a device
recovers when the server refuses it under that rule (#3263).
A Loro operation id is a peer and a counter, and each committed update
declares a span (peer, start, end) for every peer it carries. The server keeps
the committed frontier F, the highest span end on each peer. Readers apply
updates in server order and void one that reuses an op id they already hold
with other content, so the earliest carrier wins. Before this rule, a member
who read a device's peer from history could commit that peer's next counters
before the device's own update landed, and every reader then voided the
device's update.

The server now walks a request's spans under the document lock. A span ending
at or below F re-asserts committed counters, which any writer may do. A span
past F claims an unowned peer for its writer's user, passes on a peer that
user owns, and refuses the whole request on a peer another user owns, naming
the refused peers with their frontiers. Peers are secret per record (part
B1a), so nobody can name an honest device's peer before that peer's first
commit, and that first commit claims it.

Only a billing purge of a whole organization frees a document's id. It deletes
the document's rows, owner rows included, and the organization's owner then
recovers by republishing the document from local history under the same id. The
purge reserves each freed id for that owner, so no other user can create it
first
([reserved ids](../../docs/developer/billing-purge-recovery.md#reserved-ids)). A
purge of one document is permanent: a create of its id is refused with 409
"Document was permanently purged". A recreation claims every peer in the history
it carries, since F starts at 0. A device still holding unsent operations on
such a peer is refused. It forks its document at A = min(live, F) on each
refused peer, moves to a fresh secret peer, writes everything past A again on it
(the content stays, the attribution does not), and resubmits. Nobody knows the
fresh peer, so the resubmission claims it, and everything else it carries is
within F.

Each update also depends on op ids its payload builds on, and a reader that
lacks one voids it (part B2). Before the rule below, a member who had read a
device's peer could commit an update on its own peer that depends on the
device's next counter. Its spans name only its own peer, so ownership passed
it. The device held that op unsent and accepted the update, while every other
reader voided it, and then every later update the device built on it. Each
update now declares its dependencies under its signature. The server refuses
a declared dependency past F, naming its peer with F, and every reader voids
an update whose payload depends on other op ids than it declares. Every reader
then judges dependencies against committed ops, so all of them void the
forged update.

The owner may recover from a stale device, whose copy lacks operations the
server had committed. Their frontiers fall, to 0 on a peer the copy lacks
entirely, and other devices still hold them. A device that depends on one is
refused, and the frontier the refusal names is below what the device saw
committed. Forking there would write committed operations again under a fresh
peer, and every device that still holds the originals would then hold both. So
a device that sees such a frontier never forks at it. Refused for a
dependency, it relays: it queues what it holds from that frontier again, under
the operations' own ids, and resubmits. Refused on a peer another user owns,
it may not extend that peer, so it parks: it keeps its queue and submits it
again on each pass, and goes on once a device of that user has republished
the peer.

What a device saw committed is a record of its own, which a pull and an
acknowledged submit raise and nothing lowers. Its queue cannot stand in for
it: a relay queues committed operations again, and so does a full history
from counter 0 that the server refused and the device still holds queued. A
device that let either lower what it saw committed would fork at a frontier
that fell.

## Actors

- Two honest devices, each its own user, edit at the next counter of their
  current peer (`Edit`, at most `MaxEdits` each). They submit their queue,
  alone or with everything they hold (`Submit`). Carrying everything stands
  for a lagging delta, a rotation baseline, or a republished history that
  re-asserts every peer from counter 0, and one the server refuses stays
  queued. They import the committed log (`Pull`) and record what they saw
  committed (`known`): what a submit landed and what a pull imported. No
  action lowers it, and a device reads it no further than it holds
  (`SeenCommitted`).
- A refused device takes one of three steps. When every named frontier covers
  what it saw committed there, it rebases (`Rebase`). When one is below
  (`Regressed`), it relays what it holds from that frontier if the refusal was
  for a dependency (`Relay`), and parks if it was for a peer another user owns
  (`Park`). A parked device submits again on its next pass.
- A dishonest member commits forged content at one counter of a peer it can
  name (`Forge`): a re-assertion below F, or the peer's next counter. Or it
  commits an op on its own peer whose payload depends on a nameable peer's
  next counter, declaring that dependency or none (`ForgeDependent`). It can
  name only peers in the committed log (`Nameable`).
- A republisher recreates the document from a copy of its committed history
  (`Recreate`), at most `MaxRecreations` times: what a reader held after some
  prefix of the log, which is stale unless the prefix is the whole log. In
  production it is the owner of an organization a billing purge deleted, the
  only user the purge's reservation of the freed id admits. The republisher's
  other device, which holds everything committed before the purge (`purged`),
  may republish it as one full history (`Restore`).
- Readers judge the committed log in server order (`Reader`, `JudgeFrom`): an
  entry is void when it reuses a held op id with other content, depends on an
  op id they do not hold, or depends on other op ids than it declares
  (`Unreadable`). A device judges from what it holds, unsent ops included.

A request is one update here, and the device's request and the server's
locked processing are one step. The owner row is the writer of the first
committed entry carrying a peer, because that entry is past F = 0 and claims
it. Every writer declares exactly the operations it carries. An honest update
depends on every op the device holds that it does not carry, and declares
exactly that; a recreation's full history depends on nothing. A refusal names
the peers another user owns when there are any, and otherwise the peers of the
uncommitted dependencies.

## Production Mapping

| Model action or predicate | Production implementation |
| --- | --- |
| `Submit` / `Refuses` / `Preempting` / `Uncommitted` | `claimDocumentPeers`, called from `appendDocumentUpdates` with the request's newly verified updates while the document head lock is held; its pure core `judgeDocumentPeerSpans` (in the validators package) walks each update's declared dependencies, then its spans, in request order and raises each frontier as it goes |
| `Owner` | a `document_peer_owners` row (`documentPeerOwners`), written by `claimDocumentPeers` when a span past the frontier extends an unowned peer |
| `Frontier` | `readCommittedDocumentPeers`, which reads each named peer's highest committed span end with its owner row |
| `RefusedPeers` / `refusal` | the 409 `document_sync_peer_owned`, or `document_sync_dependency_uncommitted` when no span is refused, whose `peerFrontiers` name at most `MAX_DOCUMENT_PEER_FRONTIERS` refused peers with the frontier committed before the request, which rolls back |
| `deps` and an entry's declared set | the `dependencyVersionVector` that `encryptDocumentPendingUpdate` reads from the payload with `getImportBlobMetadata` and signs in `computeDocumentContentRecordMetadataHash`; the server stores it in `documentUpdates.dependencyVersionVector` and serves it |
| `Rebase` / `ForkPoint` / `Renumber` | `rebaseOntoFreshPeer`, which cuts each refused peer at min(live, F), keeps every other peer whole, and writes the cut operations' net effect under a fresh peer; the sync failure action `rebase_peer` hands the refusal to `planPeerRefusalRecovery`, which runs it, and the pass resubmits |
| `known` / `SeenCommitted` | the record's `committedVersion`, which `settleDocumentSyncResponseInTransaction` raises with the spans a sync response showed (`documentSyncCommittedVersions`: acknowledged outgoing updates and accepted served updates) and `installDocumentPeerRebase` raises with what the recovery knew; `knownCommittedOf` reads it no further than the live document. Production also counts what lies below the queue's start (`unsentStartOf`), which covers an operation committed by a create and brought by no settlement; every operation here comes from a pull or a submit, so `known` already holds it |
| `Regressed` | the `history_regressed` result of `rebaseOntoFreshPeer`, reported before it cuts anything |
| `Relay` / `Lost` | the relay plan of `planPeerRefusalRecovery`, installed by `installDocumentPeerRebase`, whose `replaceQueueWithRelay` replaces the queue with one update and leaves the record and its history |
| `Park` / `AwaitsOwner` | the park plan of `planPeerRefusalRecovery`; `rebaseAfterPeerRefusal` reports it through `parkUntilOwnerRestores` as `document_peer_restore_awaits_owner` and leaves the queue |
| `CurrentPeer` / `Nameable` | `recordPeerSeed`, which derives a record's peer from a device-local secret seed |
| `Recreate` | the organization billing purge, whose `deleteOrganizationRemoteRows` deletes each document's rows, owner rows included, through `deleteDocumentRows`, followed by the owner's `session.recoverPurgedOrganization` (`recoverPurgedSessionOrganization`), whose remote reset queues each document's local history; document sync then creates the document under its `recoveryDocumentId` with that history as its seed, which is stale when that device's copy is. The purge reserves each freed id for that owner (`reservePurgedOrganizationObjects`), and the create guard refuses it to any other user. A single-document purge (`runPurgeDocumentWorkflow`) keeps its signed purge event, so a create of that id is refused |
| `Restore` / `purged` | another device of the owner adopting the replacement: its remote reset (`buildResetPlans`) queues everything it holds as one update from counter 0 |
| `Reader` / `JudgeFrom` / `Pull` | `judgeOnScratch`, which voids the later carrier of a reused op id and an update whose dependencies it lacks |
| `Unreadable` | `assertDecryptedDocumentUpdateMetadata`, which voids at stage `loro_metadata` an update whose decoded dependencies differ from its declared ones |
| `Forge` / `ForgeDependent` | a modified client's request, judged by the same `claimDocumentPeers` |

The server rule is `judgeDocumentPeerSpans` in
[`documentPeerSpans.ts`](../../packages/validators/src/documentPeerSpans.ts).
[`documentPeerOwners.ts`](../../packages/api/src/documents/documentPeerOwners.ts)
reads the committed peers for it and writes the claims, called from
[`appendOutgoingUpdates.ts`](../../packages/api/src/workflows/documents/mutations/appendOutgoingUpdates.ts).
The owner table is
[`documentPeerOwners.ts`](../../packages/api-shared/src/schema/documentPeerOwners.ts),
and the organization purge in
[`organizationPurgeRows.ts`](../../packages/api/src/workflows/billing/organizationPurgeRows.ts)
deletes its rows through
[`purgeDocumentRows.ts`](../../packages/api/src/workflows/documents/mutations/purgeDocumentRows.ts).
The owner's recovery, `recoverPurgedSessionOrganization`, is in
[`sessionPurgeRecovery.ts`](../../packages/client-sdk/src/client/session/sessionPurgeRecovery.ts),
and its remote reset queues the republish in
[`remoteReset.ts`](../../packages/client-sdk/src/workflows/sync/remoteReset.ts).
The single-document purge in
[`purgeDocument.ts`](../../packages/api/src/workflows/documents/mutations/purgeDocument.ts)
keeps its purge event, which
[`documentRows.ts`](../../packages/api/src/workflows/documents/mutations/shared/documentRows.ts)
reads to refuse a create of the purged id.
The refusals are declared in
[`documentSyncError.ts`](../../packages/validators/src/response/documentSyncError.ts),
and the reader's dependency check is in
[`documentUpdateIntegrity.ts`](../../packages/client-sdk/src/data/documents/shared/documentUpdateIntegrity.ts).
The device side is
[`peerRebase.ts`](../../packages/client-sdk/src/data/documents/shared/sync/peerRebase.ts)
and
[`peerRefusalRecovery.ts`](../../packages/client-sdk/src/data/documents/shared/sync/peerRefusalRecovery.ts),
the failure action in
[`syncFailures/index.ts`](../../packages/client-sdk/src/workflows/documents/syncFailures/index.ts),
the pass's handling in
[`syncPeerRebase.ts`](../../packages/client-sdk/src/workflows/documents/sync/syncPeerRebase.ts),
the install in
[`peerRebaseInstall.ts`](../../packages/client-sdk/src/data/persistence/documents/records/peerRebaseInstall.ts),
and the secret peers in
[`crdtPeerSeed.ts`](../../packages/client-sdk/src/data/sync/crdtPeerSeed.ts).

## Invariants

The checked configuration sets every switch to its safe value and requires
that:

- no reader voids a committed honest update, a device's or the republisher's
  (`HonestUpdatesAccepted`);
- no committed update by another user occupies a device's counters past what
  that device has had committed (`NoPreemption`). A ghost (`ownerEnd`)
  records that end across a recreation, so the republisher's copy of what the
  device committed passes, and the invariant does not depend on the server's
  own owner rows;
- an honest request is refused only for a span past F on a peer another user
  owns, or for a dependency on an operation the device saw committed and a
  recreation lost: never for a re-assertion within F, nor for a dependency
  that nothing lost (`ReassertionsNeverRefused`);
- a device is refused only after a recreation, rebases at most once for each,
  and every relay queues an operation that was not queued, so no recovery
  repeats without moving (`RebaseCannotLoop`). The resubmission after a rebase
  may still be refused for a dependency a stale recreation lost, which a
  relay answers;
- no reader, fresh or a device, holds one honest edit under two op ids
  (`NoDuplication`): no honest device writes again, under another peer, an
  operation that was committed;
- no device accepts a committed update that a fresh reader voids
  (`ReadersAgree`), so nothing a device builds on is void for the other
  readers. A device voiding what a fresh reader accepts is a preemption of its
  unsent operations, which `NoPreemption` excludes.

A refusal here names every refused peer, so `MAX_DOCUMENT_PEER_FRONTIERS`
never binds. A request refused on more peers than the server names keeps the
unnamed ones whole and is refused again for them. Each such refusal costs
another rebase or relay, which the model does not exercise.

## Liveness and Fairness

`HonestWorkEventuallyCommitted` requires that every queued honest edit's
content is eventually committed and accepted by readers, possibly under a
rebased peer, unless from some point on the device awaits the owner of a peer
whose history fell (`AwaitsOwner`): the server holds less of a peer another
user owns than the device saw committed there.

Only a device's own steps are fair: `Submit`, its recovery (`Rebase`, `Relay`,
or `Park`), and `Pull`. Edits are not, and the property speaks only of edits
queued. The dishonest member and the republisher have no fairness. So a device
that a recreation refused recovers with its own steps alone in every case but
one. A parked device waits for a device of the user who owns the peer, and
`Restore` is not fair, so the model lets it wait forever. That is a deliberate
exception to the no-brick rule
([limits](../../docs/limits.md#limits-that-trade-write-liveness)): the device's
other choice is to write committed operations again, which `NoDuplication`
forbids. Once the frontier covers what the device saw committed, its next
refusal names a frontier it may fork at, and it rebases and lands.

The property speaks of queued edits, not of every edit made. A stale
recreation can lose an operation of a device whose queue is empty, and that
device learns of it only when it next writes, or when another device relays
the operation or the owner's other device republishes it.

## Negative Controls

Each control flips one switch and the negative-control check asserts the
named violation on every run:

| Switch | Expected violation |
| --- | --- |
| `NoOwnership = TRUE` | `NoPreemption`: after a device's first commit, the dishonest member commits its next counter and the server stores it |
| `RefuseForeignSpans = TRUE` | `ReassertionsNeverRefused`: a device that pulled another device's operation is refused for re-asserting it within F alongside its own first edit |
| `NoRebase = TRUE` | `HonestWorkEventuallyCommitted`: a recreation claims a device's peer, and the device's unsent edit is refused on every retry |
| `PublicPeers = TRUE` | `HonestUpdatesAccepted`: the dishonest member claims a device's peer at counter 0 before its first commit, so the device's update is a re-assertion within F that every reader voids |
| `NoDependencyCheck = TRUE` | `ReadersAgree`: after a device's first commit, while it holds its next counter unsent, the dishonest member commits an op depending on that counter; the device accepts it and a fresh reader voids it |
| `NoDeclaredJudge = TRUE` | `ReadersAgree`: the same forged op declares no dependency, so the server's dependency rule passes it, and only the device accepts it |
| `NoRelay = TRUE` | `NoDuplication`: a stale recreation loses a device's committed edit, the device forks at the frontier that fell and commits the edit again on a fresh peer, and the owner's other device then republishes the original |
| `ForgetRelayed = TRUE` | `NoDuplication`: a device relays another device's lost operation and is refused again, because the republisher owns that peer; the relay lowered what it saw committed to its queue's start, so it takes the relayed operation for unsent, forks at the same frontier instead of parking, and commits it again on a fresh peer |
| `ForgetQueuedHistory = TRUE` | `NoDuplication`: a device pulled another device's two edits and a stale recreation kept one; it sends its own edit with its full history and is refused on that peer; the queued history lowered what it saw committed to nothing, so it forks at the frontier that fell and commits the lost edit again on a fresh peer, and the other device, which still holds the original, then holds both |

## Outside the Model

- The causal closure `rebaseOntoFreshPeer` takes before it cuts: an operation
  on an unnamed peer that depends on a cut one is cut too. `Rebase` here keeps
  every unnamed peer whole.
- A refused `Restore`. A relay claims an unowned peer for the relaying
  device's user. If that device held less of the peer than the owner's other
  device does, the republish extends another user's peer and the server
  refuses it. Here `Restore` then never happens. In production that device's
  remote reset counts nothing as committed, so it rebases and writes the rest
  of the peer again on a fresh peer, and a device that still holds those
  operations then holds both. The peer's own device, refused on a peer the
  relaying user now owns, parks, and only that user's device, which lacks the
  operations, could release it. Not closed (#3263).
- A parked device that no device of the peer's owner can release, because
  none holds the operations it saw committed. `Restore` here republishes
  everything the server held.
- Dependencies as Loro records them: the frontier of the ops a change was made
  on. An honest update here depends on everything the device holds that it
  does not carry, which is that frontier's closure.
- Overclaims on one's own peer, which
  [VoidUpdateProgress](./VoidUpdateProgress.md) covers.
- Several devices of one user, which share ownership of each other's peers.
  Each device here is its own user.
- A malicious republisher of offline edits on a surviving record, who can
  only be the purged organization's owner, since the purge reserves the freed
  id for that user. The republisher here carries only what
  a reader holds. One that commits forged content at a device's unsent
  counters raises F over them, so the device's resubmission is a re-assertion
  that readers void. This is an accepted residual.
- A dishonest member who names a peer a stale recreation lost. The dishonest
  member here names only peers in the current log. A recreation from a copy
  that lacks a peer entirely leaves it unowned while a device still holds
  operations on it. A member the owner re-invites into the replacement
  organization, who knows the peer from history before the purge, can claim it
  if it acts before a device holding those operations relays them: with forged
  operations at the device's counters, which other readers accept and the
  device voids, or with a void span over them and then an update that depends
  on them, which the device accepts and other readers void. F counts the spans
  of void updates, so the dependency rule cannot tell such a cover from
  committed operations. This is an accepted residual (#3230). Keeping owner
  rows across the purge would close it, but the server cannot tell an honest
  member's relay of the lost peer from such a cover, so it would refuse the
  relay, and the relaying device would park until the peer's own user
  republished it.
- The in-order walk across several updates of one request, in which an
  update may depend on an earlier one, which the collapse into one update
  leaves out.
- A full history that waits in the queue before its first submit. Here it is
  queued by the submit the server refuses, so no edit or pull falls between
  queueing it and sending it.
- A remote reset and a discard, which clear what a device saw committed. A
  device here keeps `known` for good.
- A relay with nothing to add. `RebaseCannotLoop` shows that one device's
  relay always queues an operation that was not queued. Two runtimes on one
  database can still answer the same refusal, and the second then finds the
  lost operations queued; `planPeerRefusalRecovery` reports that as
  `nothing_to_relay` and the pass ends with the server's own refusal.
- Lost acknowledgements. A device whose update the server committed before a
  purge without the device learning of it still holds that update queued. If
  it pulled an operation that depends on the update, and a stale recreation
  then claims the peer at a frontier that covers what the device knows is
  committed, it forks there, and the fork's closure reaches the pulled
  operation. `rebaseOntoFreshPeer` refuses to write that operation again and
  throws, as it does for a forged one.

## Bounds

The configuration bounds two edits per device, one recreation, and one
forgery. TLC explores 569,988 generated and 156,331 distinct states at depth 23
in about 4 minutes with one worker. Within these bounds both devices can be
refused by one recreation and rebase, a rebased resubmission re-asserts the old
peer the republisher owns, a forged re-assertion within F is committed and
voided, a forged dependency on a device's unsent counter is refused, and one
that declares no dependency is committed and voided by every reader. A stale
recreation loses a committed edit; a device relays its own lost operations and
another device's, claiming a peer the copy lacked; a device parks on a peer the
recreation claimed, and after the restore rebases and lands; a device whose
refused full history stays queued parks at a frontier that fell, and after the
restore lands it as a re-assertion; and a restore is refused after a relay
claimed part of a peer it extends. This is exhaustive bounded model checking,
not an unbounded proof.
