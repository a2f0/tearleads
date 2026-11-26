# Peer Ownership

Earliest-wins voids the later of two
[updates](./glossary/content.md#loro-update) that carry the same operation ids
(peer and counter) with different operations
([void updates](./advisory-op-spans.md#void-updates)). A writer that committed
operations under another device's peer id at that device's next counters,
before the device's own update landed, would make every reader void the
device's update. The server now refuses that: past a peer's committed
frontier, only its [peer owner](./glossary/sync.md#peer-owner) may write
([what the server checks](./advisory-op-spans.md#what-the-server-checks)).

A writer derives a separate peer id for each document or container it writes,
from a seed that never leaves its device, the signed-in user, and the record
(`recordPeerSeed`). Another member therefore cannot read a device's peer id on
a document from that device's updates to other documents: it first sees the
peer id in the device's first commit on the document, and by then the device's
user owns it. Two identities on one device also never write one history under
one peer id. The first update of a new container's metadata, organization
profile, or roster profile goes under a fresh peer id that is never reused.

This page covers the dependency rule, what a device does when the server
refuses it under either rule, and what remains open. The rules and the
recovery are modeled in
[`PeerOwnership.tla`](../formal/document-sync/PeerOwnership.md).

## Dependencies

A Loro update depends on the operations outside it that its changes were made
on, and a reader that lacks one cannot import it. Before the server checked
dependencies, a member who had read a device's peer could commit an update on
its own peer that depends on the device's next counter. Its spans name only
its own peer, so ownership passed it. Every reader that lacked that operation
voided it, but the device held it unsent and accepted it. Its later updates
then built on the forged one, and every other reader voided each of them: the
device was silenced on the document without notice.

Now the server refuses an update whose declared dependencies are not
committed, and every reader voids at stage `loro_metadata` an update whose
payload depends on other operations than it declares. Loro reads the
dependencies it reports for a blob from the same encoded data its import
applies, so the comparison needs no trust in the blob's checksum, which anyone
can recompute. Every reader then judges a dependency against operations
committed before the update, so the device voids the forged update too.

An honest update depends on operations its writer holds: foreign ones it
pulled, which are committed, and its own, which are committed or carried by
an earlier update of the same request. Its dependencies are refused only when
a billing purge and a recreation from a stale copy lost an operation it
depends on. The device then sends that operation again
([after a stale recreation](#after-a-stale-recreation)).

## Rebasing onto a fresh peer

A device whose sync is refused with `document_sync_peer_owned` or
`document_sync_dependency_uncommitted` first compares each frontier the server
named with what it [knows is committed](#what-a-device-knows-is-committed) on
that peer. A frontier below that means the server's history went backwards,
and the device does not rebase
([after a stale recreation](#after-a-stale-recreation)). Otherwise every
operation past a named frontier is one the device has not sent, and it
rebases.

For each refused peer it keeps the operations below the frontier the server
named and cuts the rest, then cuts every operation that depends on a cut
one. It writes the cut operations' net effect again under a fresh peer, on a
fork of what it kept, and replaces the record's queued updates with one update
holding every fork operation from where its unsent operations start: on each
peer, the lowest of its pending base and every queued update's start on that
peer. That update re-asserts the refused peer's committed counters, which any
writer may do, and extends only the fresh peer, so the retry lands. Operations
committed on a refused peer stay under their ids in the fork whoever committed
them, and everything the fork writes again was unsent, so no reader sees an
operation twice.

The rebase never cuts what the device knows is committed (on a refused peer,
below the named frontier; on any other peer, what it has seen committed):
writing it again under the fresh peer would duplicate it for every reader. If
the cut would reach such an operation the rebase throws
`PeerRebaseCommittedCutError`, and the pass records the refusal as a terminal
failure. The server refuses an update that depends on an uncommitted
operation, so only a forged committed operation gets there, or the
[lost acknowledgement](#residuals) below. A refusal that names no frontiers,
such as an unlink's, fails that operation; the document's next sync draws the
refusal with its frontiers and recovers, so a retry builds on the result.

A document's fresh peer comes from a new random salt its record keeps
(`peer_salt`), so a reload writes on that peer and not the refused one. One
transaction replaces the record's history with the fork's full history, its
queue with the one update, and its void rows and preemption notices with none,
and moves the record to the next recovery generation, which fences out every
writer that read the old history. It writes nothing if the record or its
history moved past what the rebase read: another tab's queued edit is merged
into the fork before the cut, and one queued after that read makes the device
rebase again on its next refusal. Container metadata rebases the same way, with
its stored content as the fence, onto a random peer it keeps in memory only. A
reload derives the writer's own metadata peer again, which the server still
refuses, so the next write after a reload rebases again, once per written
container and session.

## What a device knows is committed

A device knows an operation is committed in one of two ways, and counts
whichever shows more on each peer, never past the document it holds.

**Outside the queue.** An operation enters a record from the server or from a
local write, and a local write stays queued until the server acknowledges it.
So everything the record holds below where its queue starts is committed: on
each peer, the lowest of its pending base and every queued update's start.

**On record.** The queue can also send committed operations again. A relay, a
rotation baseline, and a republished history each queue a peer from counter
zero, and by its queue alone the device would then count nothing on that peer
as committed, read a frontier that fell as an ordinary one, and write
committed operations again on a fresh peer. So each record also keeps a
committed version (`documents.committed_version`,
`DocumentRecord.committedVersion`): per peer, the highest counter a sync
settlement showed the server to hold. No queued update lowers what it says.
Three writes raise it, each merging and keeping the higher counter on each
peer:

- a pull served an update and the pass accepted it: the update's span;
- the server acknowledged an outgoing update: its span. A document create's
  seed, a heal's baseline, and a rotation's raw-history rebuild count the same
  way;
- a rebase or a relay is installed: what the device knew when it planned the
  recovery. The one update the install queues may start below operations that
  were known committed only for being outside the queue.

The first two run in the transaction that settles the sync response, and the
third in the install's. No other write touches the column: an ordinary save, a
queue change, and a rotation leave it as it is, and it survives a reload.

A folder's create seed and a registration's first updates are committed by
their create and reach no settlement, so the record does not name them. They
are known for being outside the queue, and a relay records them before it
queues them again.

Three events change what the version describes:

- **A rebase** raises it and lowers nothing. The fork keeps every operation
  the device knows is committed, on the refused peers and on every other.
- **A discard** of local edits clears it. The record drops its history, and
  the operations it writes next may reuse counters that history held.
- **A remote reset** clears it. The device strips the record's server
  identity and queues its whole history as unsent, so none of it counts as
  committed on the replacement ([residuals](#residuals)).

A folder that follows its own user's recreation
([purge recovery](./developer/billing-purge-recovery.md#stale-copies)) keeps
its history and queue, and keeps the version with them: that is what lets it
see that the replacement lacks operations the old stream committed.

## After a stale recreation

A committed frontier falls only when a billing purge deletes the document and
the organization's owner recreates it from a device whose copy lacks committed
operations ([purge recovery](./developer/billing-purge-recovery.md#stale-copies)).
Other devices still hold those operations under their own ids, and nothing
tells them the server lost any. A device finds out when an edit of its own
depends on one: the server refuses it and names a frontier below what the
device [knows is committed](#what-a-device-knows-is-committed) on that peer.
Cutting there would write committed operations again under a fresh peer, and
every device that still holds the originals would then hold both. So the
device never rebases at such a frontier. What it does depends on which rule
refused it.

**Relay.** Refused with `document_sync_dependency_uncommitted`, the device
sends the lost operations again. It replaces its queue with one update that
holds every operation from the named frontier on each such peer, with what the
queue already held, under the operations' own ids. The document, its history,
its writer peer, and its recovery generation stay as they are; the same fenced
transaction as a rebase's replaces the queue and raises the record's committed
version. The update extends a peer the stale copy lacked, which is unowned, so
it claims that peer for this device's user. A refusal names only the peers an
update depends on directly, so one that depends on several lost peers is
refused once for each before it lands.

A relay's update starts below operations the device knows are committed, so
the queue no longer shows them as such. The install therefore raises the
record's committed version to what the device knew, every later refusal is
judged against it, and a rebase that follows a relay still cuts only what the
device never sent.

A dependency refusal can name a frontier that fell although the queue already
starts at or below it: another runtime on the database relayed after the
refused request was built, or the request carried only part of the queue. A
relay would queue the same operations again, and no other user owns the peer,
so the device neither relays nor parks. The pass reports the server's own
`document_sync_dependency_uncommitted` refusal to `onTerminalSubmitFailure`,
and the next pass sends the queue.

**Park.** Refused with `document_sync_peer_owned` at such a frontier, the
device may not extend the peer: the recreation's seed held part of it and
claimed it for the owner. It parks. The queue, the document, and its history
stay as they are; the document stays readable and editable, and new edits
join the queue. The pass reports `document_peer_restore_awaits_owner` to
`onTerminalSubmitFailure`, as it reports an
[ancestor repair it cannot make](./developer/client-sdk/public-api.md#public-api-entry-points),
and built-in stores keep its message on the
[write-queue row](./sync-edge-cases.md#queue-statuses). Nothing is logged as an
error and no new pass is requested. Every later pass submits the queue again.
Once a device of the peer's owner has republished the peer up to what this
device holds, the refusal names a frontier that covers what the device knows,
the device rebases its unsent operations onto a fresh peer, and the pass that
lands them clears the row.

Parking makes a writer wait on another user's device, which the no-brick rule
otherwise forbids ([limits](./limits.md#limits-that-trade-write-liveness)).

Container metadata follows the same rules. Its content is a map, so writing an
entry again is not visible as a duplicate, but a rebase that would cut a
committed operation threw before, and now relays or parks.

## Residuals

- **Recreation preemption.** Only an organization's billing purge frees a
  document's id, and only for that organization's owner ([reserved
  ids](./developer/billing-purge-recovery.md#reserved-ids)); a purge of one
  document is permanent (409 "Document was permanently purged"). The owner's
  devices recreate it from local history (`recoverPurgedOrganization`). The
  recreator owns the peers its copy carries, so a malicious owner can commit
  their next counters before the devices' offline edits land. Those devices
  rebase keeping their operations below its frontier as committed, and readers,
  holding its operations there first, void the re-assertion.
- **Dependencies on void spans.** The server judges a dependency against the
  committed frontier, which also counts the spans of updates every reader
  voided, since it cannot read a payload. Only a peer's owner raises that
  frontier, so a member can cover operations nobody committed only on its own
  peer, where no honest device holds any, or on a peer a purge left unowned.
  The owner's recovery from a stale copy lacking a device's peer entirely
  leaves it unowned, and a re-invited member who knows it can claim it before
  a device holding its operations relays them: with a void span over them and
  a dependent update, which the device accepts and other readers void, or
  with forged operations, which other readers accept and the device voids.
  Accepted (#3230): kept owner rows would refuse every honest relay by another
  user's device, which would then park until the peer's own user republished
  it.
- **A relay claims the peer.** A device that relays another device's lost peer
  claims it for its own user, and it relays only what it holds. A device that
  holds more of that peer is then refused on it as another user's. The peer's
  own device parks, and only the relaying user's devices, which lack the rest,
  could release it. A device of the owner adopting the replacement runs a
  remote reset, which queues its whole history as unsent and clears its
  committed version, so it rebases instead and writes the rest of the peer
  again on a fresh peer; a device that still holds those operations then
  holds both. Keeping the version across the reset would park that device
  too, with everything else it alone can restore, on a wait no device can
  end. Open (#3263).
- **A relay is one update.** A relay sends everything the device holds from
  the named frontier as one queued update, and the fork's update after a
  rebase is one update too. On a large document that update can exceed the
  [sync request limit](./limits.md#document-sync), which no batch can split,
  and every pass then abandons with `document_sync_request_too_large`.
- **A park no device can end.** A parked device waits for a device of the
  peer's owner that holds the lost operations. If none does, it stays parked
  until its user discards the local edits
  ([row 21](./sync-edge-cases.md#edge-cases)).
- **Lost acknowledgements.** A device whose update the server committed before
  the purge, without the device learning of it, still holds that update
  queued. If it pulled an operation that depends on the update, and the
  recreation's seed claims the peer at a frontier that covers what the device
  knows is committed, the rebase would cut the pulled operation and throws.
- **Overclaims on one's own peer.** The server cannot read a payload, so an
  owner may declare a span past the operations it carries. The counters below
  that frontier are committed, so any writer may then fill them first, and
  readers void the owner's later operations there. Only a dishonest or broken
  client overclaims, and the cost falls on its own peer.
- **Same-user devices share ownership.** A peer belongs to a user, not a
  device. A modified client signed in as the same user can extend the peer of
  that user's other device, which honest devices never share, and readers void
  the later operations.
- **Operation references outside dependencies.** The rebase cuts by Loro
  dependencies. An operation that names another (a move or delete target)
  without depending on it is left to another track.

## Preemption notices

A device that is served a colliding update holds its own operations first, so
it voids the other writer's update instead. When that void reuses ids under
the peer id the device writes with, it records a notice in
`document_peer_preemptions` and reports once which writer (user and key
fingerprint) signed the update. For a rotation baseline that is the writer
that relayed the operations, not necessarily the one that forged them. A
forger that declares exactly the counters the device already holds is not
served to that device, because the device's frontier covers the declared
span, so the notice catches only a forgery the device is served. Under an
honest server a notice comes only from a non-owner re-asserting committed
counters with other operations, or from a residual above; under a dishonest
server it is the only signal. A rebase clears the document's notices and void
rows along with the history they were judged against.
