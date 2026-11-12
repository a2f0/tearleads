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
Duplicate-self cleanup must preserve contacts containing rows, including rows
that the current address editor does not recognize.

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
