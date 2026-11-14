# Container views

Explorer can display a container through one of its linked documents. Select
the container, open **Get Info → General**, and choose its **Primary document**
from the standard dropdown. Choose **None** to clear the preference. These
settings appear only in Get Info; the folder view keeps **Contact view** and
**Contents**, which returns to the list of subcontainers, uploads and row
actions.

## Identity and persistence

`ContainerNode.primaryDocumentId` comes from the encrypted container-metadata
Loro map, not a new SQL column. It is the canonical `documentId`, never the
current device's local id. Existing metadata sync and backup paths carry it.
Name, icon and primary mutations author only the keys explicitly changed,
including when rebased onto a replacement metadata identity.

`setContainerPrimaryDocument(containerId, documentId | null)` requires
write/admin container access and a hydrated target linked directly or
secondarily into that container. The target may itself be read-only. The
serialized metadata commit rechecks access and membership before persistence.
Rejected writes leave live metadata and snapshots unchanged. Clearing does
not require the old target to exist.

New offline documents are omitted from the dropdown until their first sync
assigns the canonical id, with an explanation beside the field. We do not
write `document_id` to simulate registration. Supporting pending draft
identities would require a durable, bounded reverse lookup for
`recoveryDocumentId ?? deriveStableDocumentId(localId)`; this view does not
scan every pending draft or persist a device-local fallback.

## Rendering and fallback

`loadContainerDocumentSummary({ containerId, documentId })` resolves the
canonical reference independently of the current list page. It requires a
hydrated stored document, accepts direct or secondary membership, and excludes
hidden tombstone holds. Missing, unlinked, deleted, unhydrated and unsupported
targets display the normal listing without clearing the preference. A later
projection revision can make a downloaded target available again.

Contact is the only registered container renderer. It reuses
`ContactDocumentApp`, including its avatar and fields, so changes to the
shared contact renderer also appear here. The container's existing notes
follow it as read-only `NoteDocumentApp` previews, five per page with previous
and next navigation. **Open** routes to the existing note view for editing
when permitted. Note filtering occurs before SQL counting and pagination;
previews never create an unbounded set of document stores.

Container selection loads twenty candidates per page, with the current primary
resolved separately so its label survives paging. If sync reduces the candidate
count while a later page is selected, **Previous documents** remains available
to return to the remaining choices. A failed current-title lookup shows an error
without blocking the available choices. Background projection
refreshes retain the open dropdown's choices and current label until replacement
data arrives. **None** remains available when the target is missing or the
candidate query fails. Primary selection is hidden for read-only,
metadata-unready and Trash views. Document renderers retain their own access
checks; Trash also forces them read-only.

## Adding a renderer

1. Put a reusable renderer under
   [document-types](../../packages/app/src/document-types/), not in a mini-app.
   Reuse existing document providers instead of copying data.
2. Register the stored kind in `containerViewsByKind` in
   `document-types/registry.ts`. Its optional `ContainerView` receives explicit
   local, canonical and selected-container ids plus the read-only flag. The
   ordinary editor fallback does not opt a type into container rendering.
3. Keep selection in `ContainerPrimaryDocumentField` in Get Info, and rendering
   and fallback in `ContainerDocumentView`. The contact-first layout appends
   the shared `ContainerNotes` section; adapt that composition explicitly if a
   future type needs different sections.
4. Add registry and mounted-view tests for the new kind, including fallback,
   identity, scope changes and Contents access.

Loads use request-tagged `loading | ready | refreshing | failed` transitions.
An unchanged primary stays mounted during a projection refresh, preserving
contact edits and focus. Identity, scope or access changes invalidate it;
unavailable or failed results drop the retained view. Saves use
`idle | saving | failed` transitions and a synchronous double-submit guard.
The field stays mounted while other Get Info tabs are selected, so returning
to General retains pending saves and errors. Container or account changes
remount the field session: late results cannot update its successor, and late
save failures still reach the logger.

The [browser regression](../../packages/app-web/e2e/container-views.spec.ts)
restores a synthetic registered-document backup through the shipping UI, then
exercises General-tab dropdown selection, avatar/fields, note previews,
Contents, reload, change and clear at desktop and phone sizes. It is not a
remote registration or live-sync test. Console diagnostics retain connection
refusals from the absent local development API; JavaScript errors, CSP
violations and unrelated console errors fail the regression.
