# Document Peer Ownership

[`PeerOwnership.tla`](./PeerOwnership.tla) models the server's peer-ownership
rule for document sync (#3194, part B1b), which closes
[preempted operations](../../docs/advisory-op-spans.md#peer-ownership).
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

## Actors

- Two honest devices, each its own user, edit at the next counter of their
  current peer (`Edit`, at most `MaxEdits` each). They submit their unsent
  operations, alone or with everything they hold (`Submit`). Carrying
  everything stands for a lagging delta or a rotation baseline that re-asserts
  every peer from counter 0. They rebase on a refusal (`Rebase`) and import
  the committed log (`Pull`).
- A dishonest member commits forged content at one counter of a peer it can
  name (`Forge`): a re-assertion below F, or the peer's next counter. Or it
  commits an op on its own peer whose payload depends on a nameable peer's
  next counter, declaring that dependency or none (`ForgeDependent`). It can
  name only peers in the committed log (`Nameable`).
- A republisher recreates the document from the committed history a reader
  holds (`Recreate`), at most `MaxRecreations` times. In production it is the
  owner of an organization a billing purge deleted, the only user the purge's
  reservation of the freed id admits.
- Readers judge the committed log in server order (`Reader`, `JudgeFrom`): an
  entry is void when it reuses a held op id with other content, depends on an
  op id they do not hold, or depends on other op ids than it declares
  (`Unreadable`). A device judges from what it holds, unsent ops included.

A request is one update here, and the device's request and the server's
locked processing are one step. The owner row is the writer of the first
committed entry carrying a peer, because that entry is past F = 0 and claims
it. Every writer declares exactly the operations it carries. An honest update
depends on every op the device holds that it does not carry, and declares
exactly that; a recreation's full history depends on nothing.

## Production Mapping

| Model action or predicate | Production implementation |
| --- | --- |
| `Submit` / `Refuses` / `Preempting` / `Uncommitted` | `claimDocumentPeers`, called from `appendDocumentUpdates` with the request's newly verified updates while the document head lock is held; its pure core `judgeDocumentPeerSpans` walks each update's declared dependencies, then its spans, in request order and raises each frontier as it goes |
| `Owner` | a `document_peer_owners` row (`documentPeerOwners`), written by `claimDocumentPeers` when a span past the frontier extends an unowned peer |
| `Frontier` | `readCommittedDocumentPeers`, which reads each named peer's highest committed span end with its owner row |
| `RefusedPeers` / `refusal` | the 409 `document_sync_peer_owned`, or `document_sync_dependency_uncommitted` when no span is refused, whose `peerFrontiers` name at most `MAX_DOCUMENT_PEER_FRONTIERS` refused peers with the frontier committed before the request, which rolls back |
| `deps` and an entry's declared set | the `dependencyVersionVector` that `encryptDocumentPendingUpdate` reads from the payload with `getImportBlobMetadata` and signs in `computeDocumentContentRecordMetadataHash`; the server stores it in `documentUpdates.dependencyVersionVector` and serves it |
| `Rebase` / `ForkPoint` / `Renumber` | `rebaseOntoFreshPeer`, which cuts each refused peer at min(live, F), keeps every other peer whole, and writes the cut operations' net effect under a fresh peer; the sync failure action `rebase_peer` runs it and resubmits |
| `CurrentPeer` / `Nameable` | `recordPeerSeed`, which derives a record's peer from a device-local secret seed |
| `Recreate` | the organization billing purge, whose `deleteOrganizationRemoteRows` deletes each document's rows, owner rows included, through `deleteDocumentRows`, followed by the owner's `session.recoverPurgedOrganization` (`recoverPurgedSessionOrganization`), whose remote reset queues each document's local history; document sync then creates the document under its `recoveryDocumentId` with that history as its seed. The purge reserves each freed id for that owner (`reservePurgedOrganizationObjects`), and the create guard refuses it to any other user. A single-document purge (`runPurgeDocumentWorkflow`) keeps its signed purge event, so a create of that id is refused |
| `Reader` / `JudgeFrom` / `Pull` | `judgeOnScratch`, which voids the later carrier of a reused op id and an update whose dependencies it lacks |
| `Unreadable` | `assertDecryptedDocumentUpdateMetadata`, which voids at stage `loro_metadata` an update whose decoded dependencies differ from its declared ones |
| `Forge` / `ForgeDependent` | a modified client's request, judged by the same `claimDocumentPeers` |

The server rule is in
[`documentPeerOwners.ts`](../../packages/api/src/documents/documentPeerOwners.ts),
called from
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
[`peerRebase.ts`](../../packages/client-sdk/src/data/documents/shared/sync/peerRebase.ts),
the failure action in
[`syncFailures/index.ts`](../../packages/client-sdk/src/workflows/documents/syncFailures/index.ts),
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
  owns, never for a re-assertion within F nor for a dependency
  (`ReassertionsNeverRefused`);
- every refusal of a device, and so every rebase, is paid for by its own
  recreation (`RebaseCannotLoop`), so the resubmission after a rebase is never
  refused;
- no device accepts a committed update that a fresh reader voids
  (`ReadersAgree`), so nothing a device builds on is void for the other
  readers. A device voiding what a fresh reader accepts is a preemption of its
  unsent operations, which `NoPreemption` excludes.

An honest request here holds unsent operations on one peer, its current one,
so a refusal names one peer and `MAX_DOCUMENT_PEER_FRONTIERS` never binds. A
request refused on more peers than the server names keeps the unnamed ones
whole and is refused again for them. Each such refusal costs another rebase,
which the model does not exercise.

## Liveness and Fairness

`HonestWorkEventuallyCommitted` requires that every honest edit's content is
eventually committed and accepted by readers, possibly under a rebased peer.

Only a device's own steps are fair: `Submit`, `Rebase`, and `Pull`. Edits are
not, and the property speaks only of edits made. The dishonest member and the
republisher have no fairness. So a device that a recreation refused recovers
with its own steps alone, and no device waits on another, as the no-brick rule
requires.

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

## Outside the Model

- The causal closure `rebaseOntoFreshPeer` takes before it cuts, and a
  dependency refusal of an honest update, which needs a recreation that lost
  an op the update depends on. A recreation here carries everything a reader
  holds, so it loses nothing.
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
- A recreation from a stale copy, which loses what the copy lacks. The honest
  recreation is the owner's recovery, so this needs the owner to recover from
  a device whose copy lacks a peer entirely. That peer is left unowned
  while a device still holds operations on it. A member the owner re-invites
  into the replacement organization, who knows the peer from history before
  the purge, can claim it if it acts before a device holding those operations
  relays them: with forged operations at the device's counters, which other
  readers accept and the device voids, or with a void span over them and then
  an update that depends on them, which the device accepts and other readers
  void. F counts the spans of void updates, so the dependency rule cannot tell
  such a cover from committed operations. This is an accepted residual
  (#3230). Keeping owner rows across the purge would close it, but the server
  cannot tell an honest member's relay of the lost peer from such a cover, so
  it would refuse the relay, and the relaying device's rebase would duplicate
  the peer's content for every device that holds it.
- The in-order walk across several updates of one request, in which an
  update may depend on an earlier one, which the collapse into one update
  leaves out; and lost acknowledgements.

## Bounds

The configuration bounds two edits per device, one recreation, and one
forgery. TLC explores 200,386 generated and 64,487 distinct states at depth 19
in about 55 seconds with one worker. Two forgeries also passed (2,784,619
generated and 893,624 distinct states at depth 20 in about 4.5 minutes with
four workers). Within these bounds both devices can be refused by one
recreation and rebase, a rebased resubmission re-asserts the old peer the
republisher owns, a forged re-assertion within F is committed and voided, a
forged dependency on a device's unsent counter is refused, and one that
declares no dependency is committed and voided by every reader. This is
exhaustive bounded model checking, not an unbounded proof.
