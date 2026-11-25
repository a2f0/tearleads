# Document Listing Coverage

How `@tearleads/client-sdk` finds a peer's edit to an ordinary document after
a restart or a reconnect without probing every document it holds. It
complements [client sync ordering](./client-sync-ordering.md#remote-pull-eligibility),
which lists every signal that makes a document store probe.

Probing every opened document on each restart and reconnect costs one sync,
and often one writer-projection read, for every document the account holds.
The scope opens every discovered document in the background, so that cost
grew with the account. A container lane's listing answers the same question
for all of its documents at once, so a document whose lane is listed is not
probed on its own.

Each document in a lane's listing carries `updateCount`: how many updates the
server holds for it, read with the row. The server keeps the count on the
document row, in the transaction that inserts an update. The mechanism is the
one [container metadata][metadata-debt] uses:

- Owing a read. A listed document whose count the device's
  [processed cursor](./advisory-op-spans.md#the-processed-cursor) does not
  cover owes one read; a count of 0 never does. The cursor counts only while
  the running judge reached it and the record's persisted frontier still
  covers its version, which are the rules for sending it. A create that
  commits its seed saves the cursor for that one update, so a device's own
  create owes nothing.
- Durability. The debt is written to `document_listing_revalidations`, at the
  listed count, before the lane's watermark advances past the row. A listing
  read from a lagging replica never lowers a debt.
- Who reads. Once the debt is durable, the document's registered store is
  asked to probe. A store that opens later reads its document's debt when its
  record loads, and a store that knows of a debt is not covered until it
  settles.
- Settling. A completed pull settles the debt it saw before its request, and
  only once the cursor that pull saved counts as many updates as the listing
  advertised. A replica lagging the listing can answer without the edit; the
  store then asks for one more pull two seconds later, and the debt otherwise
  waits for the next pull, reconnect or restart.
- Coverage. Every write that changes what a pull or an attachment listing
  returns touches the document row, so the row is published past each of its
  lanes' watermarks. Every acknowledged connection, the first after a restart
  included, lists every known document lane from its watermark, in a sweep
  that starts after the acknowledgement. That sweep revalidates nothing else:
  only an explicit Refresh still forces every registered document.
- Hints. A store reads hints only once its record has loaded and while a view
  hands it runtimes. The scope remembers which documents the hints it saw
  named, and a store whose document was named before its record loaded probes
  once.
- Fallback. A store probes as before when no listing vouches for it: no
  listing authority is installed for its scope, its container is not one the
  sweep lists, its record has not completed a pull, or its lane's last listing
  attempt failed or was refused. A lane the sweep cannot list also has every
  registered document probed at once, and keeps a force for its retry. The
  worst case is the earlier cost, never a refusal.
- Attachments. Attachment bytes download after a sync response, so a document
  that names an attachment whose bytes the device does not hold also probes.
- No-brick. The read is this device's own pull, with its stored commit
  position as the floor, and never waits on another device.

An SDK that predates the debt advanced lane watermarks without this check, so
a local schema migration forgets every document-lane cursor once. Each lane
then lists from its start, which checks every row.

Two tabs that share one database share its lane watermarks. The tab that
lists a row records the debt and pulls; the other tab's listing no longer
returns the row. Its catch-up ends by reading the debt table, so it pulls a
debt the first tab has not settled yet, but once that tab's pull settles the
debt, the second tab's open store keeps its older in-memory copy until a hint,
a write of its own, or a reload.

[metadata-debt]: ./client-sync-ordering.md#container-metadata-under-lost-hints
