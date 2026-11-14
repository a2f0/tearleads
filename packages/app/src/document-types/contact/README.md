# Contact addresses

Contacts and Explorer edit the same contact document. After creating a contact,
enter edit mode to add any number of labeled postal addresses. Each address has
street, apartment/suite, locality, region, postal code, and country-code fields;
postal codes remain strings so leading zeroes survive. Addresses share the
contact's access permissions, rather than being independently shared documents.

## Storage and editing

The [address model](contactAddressModel.ts) identifies postal-address records
with `recordType: "postalAddress"` in the document's root `rows` collection.
Each stable row ID identifies a nested Loro map. Saving an existing address
patches only changed cells: concurrent edits to other fields or addresses are
not replaced by an old form snapshot. Same-cell conflicts still resolve to one
value. Unknown row types are preserved for future contact record types.

[ContactAddresses](ContactAddresses.tsx) is shared by the Contacts mini-app and
[Explorer's document view](ContactDocument.tsx). The Contacts store initially
loads a scalar SQLite projection; addresses show a loading state until their
Loro document is ready. Address contents are not indexed in that projection.
Distinct contacts keep their own rows and histories, including row types the
current address editor does not recognize.

Both adapters use the same
[address writer](../../stores/documents/contactAddressWrites.ts). Add retries
retain a per-draft identity rather than matching field values, so independent
identical addresses remain distinct. A failed save may already have changed
live Loro state: its draft is retained and cancellation is disabled until
recovery. Failed removals keep a retry action even if the row disappears from
the live snapshot. An explicit refusal before effects permits cancellation or
dismissal only when no earlier attempt remains uncertain; refusing a retry
does not erase that earlier uncertainty. Navigating away is not a rollback.
Success acknowledges local persistence, not remote synchronization.

Address mutations carry their current writable/editor scope into the SDK's
write queue, including pending-delta flushes. The SDK rechecks that guard before
starting the queued mutation; creation retries retain both their original and
current caller's authority. Expiry before this point prevents the write, but
expiry after live mutation is not rollback and does not cancel persistence
already underway. The adapter still refuses a stale completion.

## Personal Me identity

Self-contact bootstrap and self-import use one canonical document for the
current signing identity. Its creation-local ID is
`getSelfContactLocalId(signingFingerprint)`; its remote ID is the public SDK's
`deriveStableDocumentId` of that local ID. Recovery may use another local alias
for the same remote document. A persisted `documentId` or `recoveryDocumentId`
takes precedence over deriving a planned ID from an alias.

This is a greenfield contract: there is no compatibility lookup or migration
for older container/user-derived self-contact IDs. A separate contact is not
adopted as Me merely because its user ID, keys, or `isSelf` field match. Roster
profile documents remain separate, including when moved or linked into
Contacts. Bootstrap and self-import do not merge or purge distinct documents,
and ordinary scalar, avatar, and address edits are not redirected to another
contact. Existing names and address rows are not reseeded by bootstrap.

Current-format same-document recovery remains supported. An unavailable,
read-only, or unsettled-placement target must not be acknowledged as a
successful self write. Scope and write authority still apply; deterministic
identity is not permission to write or delete. CRDT convergence reconciles
updates within one document identity, not histories of different documents.
This contract does not trigger a local-data or environment reset.

Contacts removal and Explorer move/purge protect canonical Me and its resolved
same-document aliases. Retained actions wait for pending identity reads before
their effect, after asynchronous preparation. An equivalent refresh preserves
their authority; changed identity, failed reads, or expired scope refuse them.
Once persistence starts, a later identity refresh does not cancel that write.

## Attribution

Each address's details show the last-editor attribution for its current cells,
plus created/updated metadata. The
[row-writer resolver](../../stores/documents/useDocumentRowWriters.ts) resolves
Loro peers against the server's signed-upload attribution. Unresolved writers
remain unknown; address details never substitute the row's self-attested user
IDs. Offline, unsynced, local-only, truncated, or ambiguous attribution may be
unavailable.

This identifies signed uploaders, not proof of who originally typed a value.
Peer-based cell attribution is less precise than operation-counter-based text
attribution. Timestamps are client-supplied. These details are not a complete
history of old values or deleted addresses. Explorer's document-level Get Info
continues to show scalar field attribution; use an address's own details for
its cells.
