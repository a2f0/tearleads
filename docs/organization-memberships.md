# Organization memberships

A user's membership in an [organization](./glossary/principals.md#organization)
is decided by signed
[principal policy](./glossary/principals.md#principal-policy-state): the
[reserved `Members` group](./glossary/principals.md#organization-members-group),
any other groups they belong to, and the container
[grants](./glossary/access.md#grant) those groups hold. Leaving or being removed
therefore needs an
[administrator](./glossary/principals.md#organization-admins-group) to sign a
new `Members` state and [rotate](./glossary/keys.md#rotate) its keys. A member
cannot do that for themselves.

The membership conduit is the member's own side of the relationship: product
state the member controls, which never feeds an access or keying decision.
It lives on the member's `organization_roster_entries` row, which exists for
every active or disabled
[roster member](./glossary/principals.md#organization-roster-entry).

## Discovering organizations

Every `Members` recipient can read the organization's metadata root, an
independent system [container](./glossary/access.md#container) holding the organization
profile and group names. A device therefore learns about an organization from
local state alone: `listLocalOrganizations` lists every organization the device
holds a container of, with `rootContainerId` null when the user cannot reach the
organization's workspace root. The Shared with Me mini-app lists the folders
the user can reach in each, the containers whose parent is not on the device,
each with its organization and the user's effective permission there (read,
write, or admin); an organization with none listed gets a row of its own. A
Contacts or Trash folder shared on its own is one of them; the metadata root
and roster profiles never are. Each row's context menu offers to pause or
resume sync for its organization and to ask to leave it. The Org Manager
switcher lists only workspaces, because activating an organization makes its
root the session container.

## Membership list

`GET /organization-memberships` returns one row per active roster entry of the
session user: the organization, whether it is the user's personal
organization, and the user's sync choice. It reads only the caller's rows, so
it needs no organization role and no billing entitlement.
`PUT /organization-memberships/{organizationId}` changes the caller's own row
and answers 404 unless that row is active. Deactivation clears the member's
choices, so rejoining starts with sync on.

A change publishes `organization_memberships_changed`, a user-scoped
[realtime hint](./developer/realtime-hints.md) routed like `shared_with_you` to
the user's own sockets. It carries no organization id. Clients re-read the list
when the hint arrives, each time their events socket connects, and on
`shared_with_you`, which every `Members` enrollment publishes, so a choice made
while a device was offline reaches it on reconnect and a rejoin clears a pause
left from an earlier membership.

## Pausing sync

A member can pause any organization's content sync, their personal organization
and the one their session is working in included. A pause is a hold: the device
keeps everything it has of the organization, sends nothing, and fetches nothing
until the member resumes. Nothing is deleted and nothing has to upload first, so
a device with unsent changes can pause; those changes wait in its
[write queue](./client-sync-ordering.md) and send on resume. Pausing changes no
grant, key, or policy: the member still receives key
[rewraps](./glossary/keys.md#rewrap), still counts as a billing seat, and can
resume at any time.

The pause is recorded on the server, and each device keeps the pauses in force
for it in `organization_sync_pauses`, so they are honored offline. A pause
follows the user to every device, with one exception: a pause on the user's
personal organization holds only the devices it was chosen on. A new device
needs that organization's root, Contacts, and Trash to start, so a pause chosen
elsewhere must never keep them from it. Resuming applies everywhere: once the
server no longer lists the pause, every device lifts its hold on its next
membership read.

While an organization is paused, a device:

- sends none of its writes. The organization reports as blocked to every
  [sync lane](./client-sync-ordering.md), the same per-organization check a
  lapsed billing status uses, so document updates, creates, moves, metadata,
  attachments, and key repairs for it stay queued. Sync Status says that sync
  is paused for an organization while any pause holds, queued writes or not;
- skips its containers when applying listed container pages, after tombstones
  have seen the full page, so the lane still completes and nothing below them
  is fetched. The device's own copy of each stays as it was;
- treats its stored containers as unlisted for document discovery; a listing
  in flight when the organization pauses stops at its next write, each one
  re-checking under the SQLite mutation lock, and saves no watermark, so the
  listing after a resume cannot skip what this one did not apply;
- holds the start of each routine pull of a document it has already pulled,
  deciding from the document's stored manifest without a request. A
  document's first pull still runs, so one the device has listed can still be
  opened; a pull that has fetched a page runs to its end, so no document is
  left half pulled; and so does an explicit read of a document's history;
- keeps listing the organization's metadata root, a parentless system
  container, and its documents, so a device that has never synced the
  organization still lists and names it and can resume it. Those documents
  are held like any other once pulled, so a rename made during the pause
  arrives on resume.

The sync lanes read the pauses from memory, loaded from
`organization_sync_pauses` before a store first syncs. If that read fails, the
store still opens and takes local edits, but the device cannot tell which
organizations to hold, so it holds them all until a later read succeeds and
then re-drives every lane.

A pause is the member's own choice about their devices, not a statement about
access. Container tombstones in a listed page still apply, so a folder that was
deleted, or that the member lost access to, leaves the device even while its
organization is paused.

Resuming re-drives every sync lane, which sends the writes the pause held, then
forgets which containers the device had already listed and re-lists the whole
tree and every container's documents, so the organization catches up on what it
missed. That listing queues behind any sweep that started while the
organization was paused rather than joining it.

Membership work runs one operation at a time per scope and is bound to the
scope it started in, so a stale membership read cannot undo a newer choice or
reach another identity's data.

## Asking to leave

A member cannot remove themselves, so leaving is a request an administrator
acts on. The member's device first discovers and verifies the organization's
current policy, then signs `{organizationId, userId, requestedAt, membersHead}`
under the `tearleads.organization-leave-request.v2` domain with the member's
identity signing key. `membersHead` is the exact [head](./glossary/sync.md#head)
of the reserved Members group in that policy. The member files it with
`PUT /organization-memberships/{organizationId}/leave-request`; `DELETE`
withdraws it. The API checks that the request names the caller and the path's
organization, was signed within ten minutes, and verifies against the caller's
registered signing key; the window bounds how long a captured signature could
re-file a withdrawn request. It also checks that `membersHead` is a stored state
of the organization's Members group and that the member is in every Members
state from that one on. It refuses a personal organization and a member who is
the organization's only administrator, since no one else could approve the
removal. Shared with Me offers to ask on every listed membership except the
personal one, and to withdraw once asked.

The request is stored on the member's roster row and reaches administrators in
the [organization read model's](./organization-read-model-sync.md) `directory`
lane, which the filing stamps. Only administrators and the member themselves are
served it; other members see the roster entry without it. Because the lane's
content depends on the viewer's role, a change to `Admins` stamps the
`directory` lane too, so a newly promoted administrator's next delta carries
pending requests. Each administrator's client stores the request only if it
names the organization and member, and shows it only if it verifies against the
member's [trusted](./developer/trusted-user-identity.md),
[pinned](./glossary/principals.md#identity-pin) identity, never the signing key
served beside it, so a server cannot present a request the member never made.

The client also shows a request only while it belongs to the member's current
membership, judged against the Members head in the client's own verified
organization policy. Removing anyone from Members rotates its key
[epoch](./glossary/keys.md#epoch) and key, so a request citing that head's epoch
and key has seen no removal since; one citing the same epoch with another key can
only come from a
[fork](./security-guarantees/boundaries.md#rollback-and-split-view) and is
refused. A request citing an earlier epoch is shown only if verified Members
history, read through the
[private paged verifier](./principal-history-pages.md), lists the member in
every state from the cited one on, with the cited state matching exactly. A
server that serves a request again from a membership the member left, after the
member rejoins, therefore cannot make it look current: the member's removal is
in that history. A request the client cannot place, for instance offline with an
earlier epoch, is shown as no request. Directory users a roster update returns
pass the same checks, and a pinned identity and a current-epoch request verify
offline. Org Manager shows the member as having asked to leave and offers to
approve the request.

Approving is the ordinary removal: the administrator signs the member out of
each group and then out of `Members`, rotating keys as any removal does.
Deactivating the roster entry clears the request along with the member's other
choices. Until then the member remains a full member and can withdraw.
