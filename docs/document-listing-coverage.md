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
document row, in the transaction that inserts an update. The row also carries
the document's access head, which a link change or a rotation moves without
adding an update. The mechanism is the one
[container metadata][metadata-debt] uses:

- Owing a read. A listed document whose count the device's
  [processed cursor](./advisory-op-spans.md#the-processed-cursor) does not
  cover owes one read; a count of 0 never does. The cursor counts only while
  the running judge reached it and the record's persisted frontier still
  covers its version, which are the rules for sending it. A create that
  commits its seed saves the cursor for that one update, and so does the
  provisioning that commits an organization's profile documents, so a
  device's own create owes nothing.
- Access head. A listed document also owes a read, at any count, when its
  listed access head is not the one the record's stored key bundle was issued
  under, which is the head the device's next sync would present. An open
  store keeps the access context of the head it last read, so this is what
  refreshes it after a peer's link change or rotation whose hint was lost. A
  record with no key bundle has completed no pull and is not covered.
- Durability. The debt is written to `document_listing_revalidations`, at the
  listed count, before the listed row is applied and before the lane's
  watermark advances past it. Applying a row whose access epoch moved drops
  the key bundle the record held, which would hide that move from a later
  check. A listing read from a lagging replica never lowers a debt.
- Who reads. Once the debt is durable, the document's registered store is
  asked to probe. A store that opens later reads its document's debt when its
  record loads, and a store that knows of a debt is not covered until it
  settles.
- Settling. A completed pull settles the debt it saw before its request, and
  only once the cursor that pull saved counts as many updates as the listing
  advertised. A replica lagging the listing can answer without the edit; the
  store then asks for one more pull two seconds later, and the debt otherwise
  waits for the next pull, reconnect or restart. A debt at a count of 0 is
  owed for the access head alone, and any completed pull settles it.
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
  listing authority is installed for its scope, the container that holds its
  document is not one the sweep lists, its record has not completed a pull,
  or its lane's last listing attempt failed, was refused, or was superseded
  before it applied. A lane the sweep cannot list also has every
  registered document probed at once, and keeps a force for its retry. The
  worst case is the earlier cost, never a refusal.
- Attachments. Attachment bytes download after a sync response, so a document
  that names an attachment whose bytes the device does not hold also probes.
- No-brick. The read is this device's own pull, with its stored commit
  position as the floor, and never waits on another device.

An SDK that predates the debt advanced lane watermarks without this check, so
a local schema migration forgets every document-lane cursor once. Each lane
then lists from its start, which checks every row.

Two tabs that share one database share its lane watermarks, its debts and
each saved record, but each keeps its own copy of an open document in memory.
The tab that lists a row records the debt and pulls; the other tab's listing
no longer returns the row. So a catch-up ends with two checks. It reads the
debt table, which finds a debt the first tab has not settled yet. And it
compares each open store's document in memory with the frontier its record
has on disk, which finds a document the first tab has already pulled and
settled: the store is asked for one pull. That pull cites the store's own
version, because the shared cursor was recorded with a version the store does
not cover and is withheld, so the server returns what the copy lacks. With
one tab, a store's document always holds what its record has on disk, and the
comparison asks for nothing. A local edit another tab has saved and not yet
submitted cannot be pulled; it arrives with the hint for its accepted write.
The catch-up also forgets debts of documents the device no longer holds a
record of.
[SharedDatabaseListing](../formal/document-sync/SharedDatabaseListing.md)
models the two tabs.

[metadata-debt]: ./client-sync-ordering.md#container-metadata-under-lost-hints
