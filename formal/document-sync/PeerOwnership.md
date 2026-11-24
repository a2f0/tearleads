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

A purge deletes the owner rows. A member who then recreates the document from
history that carried a device's operations claims every peer in it, since F
starts at 0. A device still holding unsent operations on such a peer is
refused. It forks its document at A = min(live, F) on each refused peer, moves
to a fresh secret peer, writes everything past A again on it (the content
stays, the attribution does not), and resubmits. Nobody knows the fresh peer,
so the resubmission claims it, and everything else it carries is within F.

## Actors

- Two honest devices, each its own user, edit at the next counter of their
  current peer (`Edit`, at most `MaxEdits` each). They submit their unsent
  operations, alone or with everything they hold (`Submit`). Carrying
  everything stands for a lagging delta or a rotation baseline that re-asserts
  every peer from counter 0. They rebase on a refusal (`Rebase`) and import
  the committed log (`Pull`).
- A dishonest member commits forged content at one counter of a peer it can
  name (`Forge`): a re-assertion below F, or the peer's next counter. It can
  name only peers in the committed log (`Nameable`).
- A republisher purges the document and recreates it from the committed
  history a reader holds (`Recreate`), at most `MaxRecreations` times.
- Readers judge the committed log in server order (`Reader`, `JudgeFrom`).

A request is one update here, and the device's request and the server's
locked processing are one step. The owner row is the writer of the first
committed entry carrying a peer, because that entry is past F = 0 and claims
it. Every writer declares exactly the operations it carries.

## Production Mapping

| Model action or predicate | Production implementation |
| --- | --- |
| `Submit` / `Refuses` / `Preempting` | `claimDocumentPeers`, called from `appendDocumentUpdates` with the request's newly verified updates while the document head lock is held; its pure core `judgeDocumentPeerSpans` walks the spans in request order and raises each frontier as it goes |
| `Owner` | a `document_peer_owners` row (`documentPeerOwners`), written by `claimDocumentPeers` when a span past the frontier extends an unowned peer |
| `Frontier` | `readCommittedDocumentPeers`, which reads each named peer's highest committed span end with its owner row |
| `RefusedPeers` / `refusal` | the 409 `document_sync_peer_owned`, whose `peerFrontiers` name at most `MAX_DOCUMENT_PEER_FRONTIERS` refused peers with the frontier committed before the request, which rolls back |
| `Rebase` / `ForkPoint` / `Renumber` | `rebaseOntoFreshPeer`, which cuts each refused peer at min(live, F), keeps every other peer whole, and writes the cut operations' net effect under a fresh peer; the sync failure action `rebase_peer` runs it and resubmits |
| `CurrentPeer` / `Nameable` | `recordPeerSeed`, which derives a record's peer from a device-local secret seed |
| `Recreate` | `runPurgeDocumentWorkflow`, whose `deleteDocumentRows` deletes the document's owner rows, followed by a member recreating the document from its copy |
| `Reader` / `JudgeFrom` / `Pull` | `judgeOnScratch`, which voids the later carrier of a reused op id |
| `Forge` | a modified client's request, judged by the same `claimDocumentPeers` |

The server rule is in
[`documentPeerOwners.ts`](../../packages/api/src/documents/documentPeerOwners.ts),
called from
[`appendOutgoingUpdates.ts`](../../packages/api/src/workflows/documents/mutations/appendOutgoingUpdates.ts).
The owner table is
[`documentPeerOwners.ts`](../../packages/api-shared/src/schema/documentPeerOwners.ts),
and the purge in
[`purgeDocument.ts`](../../packages/api/src/workflows/documents/mutations/purgeDocument.ts)
deletes its rows through
[`purgeDocumentRows.ts`](../../packages/api/src/workflows/documents/mutations/purgeDocumentRows.ts).
The refusal is declared in
[`documentSyncError.ts`](../../packages/validators/src/response/documentSyncError.ts).
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
  owns, never for a re-assertion within F (`ReassertionsNeverRefused`);
- every refusal of a device, and so every rebase, is paid for by its own
  recreation (`RebaseCannotLoop`), so the resubmission after a rebase is never
  refused.

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

## Outside the Model

- Dependencies on a peer's predicted op ids (part B2), and so the causal
  closure `rebaseOntoFreshPeer` takes before it cuts. B2 adds a switch and a
  `ReadersAgree` invariant.
- Overclaims on one's own peer, which
  [VoidUpdateProgress](./VoidUpdateProgress.md) covers.
- Several devices of one user, which share ownership of each other's peers.
  Each device here is its own user.
- A malicious republisher of offline edits on a surviving record. The
  republisher here carries only what a reader holds. One that commits forged
  content at a device's unsent counters raises F over them, so the device's
  resubmission is a re-assertion that readers void. This is an accepted
  residual.
- A recreation from a stale copy, which loses what the copy lacks, as any
  purge does; the in-order walk across several updates of one request, which
  the collapse into one update leaves out; and lost acknowledgements.

## Bounds

The configuration bounds two edits per device, one recreation, and one
forgery. TLC explores 90,450 generated and 27,087 distinct states at depth 19
in about 18 seconds with one worker. Two forgeries also passed (560,419
generated and 165,500 distinct states in about 2 minutes). Within these
bounds both devices can be refused by one recreation and rebase, a rebased
resubmission re-asserts the old peer the republisher owns, and a forged
re-assertion within F is committed and voided. This is exhaustive bounded
model checking, not an unbounded proof.
