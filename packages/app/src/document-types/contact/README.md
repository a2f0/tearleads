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
same-document aliases. Explorer's History never saves a contact version of Me
as a
[copy](../../stores/document-history/README.md#saving-a-version-as-a-copy):
it would be a second contact carrying Me's fields. Retained actions wait for
pending identity reads before their effect, after asynchronous preparation. An
equivalent refresh preserves their authority; changed identity, failed reads,
or expired scope refuse them. Once persistence starts, a later identity
refresh does not cancel that write.

The [identity source](../../stores/contacts/createSelfContactIdentitySource.ts)
reloads on births, relinks, placement, and structural discovery changes, not
ordinary autosaves. Discovery compares readiness, bucket membership, local IDs,
current document IDs, and placement without filtering by kind or folder:
canonical aliases can initially be note-shaped shells outside Contacts.
Equivalent reads preserve the displayed identity object and action authority.
This is not a general metadata-change feed: uncached deletions and arbitrary
recovery-only SQL changes require their owning operation's invalidation or
runtime replacement; the discovery comparison alone cannot observe them.

## Roster and organization profiles

Ordinary profiles are not canonical personal Me. The
[profile identity resolver](../../stores/org-manager/profileDocumentIdentity.ts)
uses a known profile pointer when one is supplied; otherwise a persisted
current identity wins over recovery identity and planned derivation. An
unrelated document occupying the preferred creation-local ID must not override
a known pointer. Resolve the actual persisted local ID for that stream and
reopen it without applying creation seeds. Existing names, addresses, unknown
rows, and other content remain on the same document; no histories are merged,
rekeyed to another ID, or purged by this lookup.

The [profile factories](../../stores/org-manager/profileDocuments.ts) seed only
a new birth. Editors opening an explicit profile pointer do not turn a failed
lookup into creation. The resolver captures one Documents workflow runtime,
and callers retain their generation guard across awaits so an old lookup or
open cannot publish into a new scope. Identity reuse does not bypass document
readiness, access checks, or existing current-format recovery.

The generic SDK birth transaction still refuses a remote alias discovered
before its write lock. Explicitly reopening a proven existing profile is not
permission to weaken that guard. Discovery landing after a negative lookup can
therefore refuse that attempt rather than create a duplicate history; a later
invocation resolves the now-persisted row.

## Bounded model coverage

The [profile identity model](../../../../../formal/local-trust/ProfileDocumentIdentity.md)
checks discovery/birth ordering, identity precedence, retained opaque content,
stale results, and positive completion for existing materialized profiles under
stable scope and fair successful local work. The
[canonical Me model](../../../../../formal/local-trust/CanonicalMeSelection.md)
checks selection and bootstrap admission, including same-stream recovery. The
[address recovery model](../../../../../formal/local-trust/ContactAddressRecovery.md)
checks queued admission, clean-state add reconciliation, durable
acknowledgement, and retaining earlier uncertainty after a later refusal.

These are bounded models, not proofs of CRDT correctness, per-cell attribution,
or complete application behavior. Runtime tests cover those implementations
and the separate retained remove/move/purge identity-authority machine. No
compatibility shim, migration, or reset follows from these contracts.

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
