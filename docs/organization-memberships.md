# Organization memberships

A user's membership in an organization is decided by signed principal policy:
the reserved `Members` group, any other groups they belong to, and the
container grants those groups hold. Leaving or being removed therefore needs
an administrator to sign a new `Members` state and rotate its keys. A member
cannot do that for themselves.

The membership conduit is the member's own side of the relationship: product
state the member controls, which never feeds an access or keying decision.
It lives on the member's `organization_roster_entries` row, which exists for
every active or disabled roster member.

## Discovering organizations

Every `Members` recipient can read the organization's metadata root, an
independent system container holding the organization profile and group
names. A device therefore learns about an organization from local state alone:
`listLocalOrganizations` lists every organization the device holds a container
of, with `rootContainerId` null when the user cannot reach the organization's
workspace root. The Organizations mini-app shows each one with the folders the
user can reach in it, the containers whose parent is not on the device. The
Org Manager switcher lists only workspaces, because activating an organization
makes its root the session container.

## Membership list

`GET /organization-memberships` returns one row per active roster entry of the
session user: the organization, whether it is the user's personal
organization, and the user's sync choice. It reads only the caller's rows, so
it needs no organization role and no billing entitlement.
`PUT /organization-memberships/{organizationId}` changes the caller's own row
and answers 404 unless that row is active. Deactivation clears the member's
choices, so rejoining starts with sync on.

A change publishes `organization_memberships_changed`, a user-scoped
realtime hint routed like `shared_with_you` to the user's own sockets. It
carries no organization id. Clients re-read the list when the hint arrives,
each time their events socket connects, and on `shared_with_you`, which every
`Members` enrollment publishes, so a choice made while a device was offline
reaches it on reconnect and a rejoin clears a pause left from an earlier
membership.

## Pausing sync

A member can pause an organization's content syncing to their devices. The
pause is recorded on the server so it follows the user to every device, and
each device keeps a local copy in `organization_sync_pauses` so it is honored
offline. Pausing changes no grant, key, or policy: the member still receives
key rewraps, still counts as a billing seat, and can resume at any time.

While an organization is paused, a device:

- skips its containers when applying listed container pages, after tombstones
  have seen the full page, so the lane still completes and its children are
  never fetched;
- treats its stored containers as unlisted for document discovery; a listing
  in flight when the organization pauses applies none of its documents,
  links, or watermark, each write re-checking under the cleanup's lock, so a
  resume lists the organization from scratch;
- keeps only the organization's metadata root, a parentless system container,
  so the organization stays named and its membership visible;
- removes the rest of its local copy: every other container of the
  organization and every document placed only in those containers.

Removal waits for the organization's local writes to upload. Pausing from a
device first asks every sync lane to upload and is refused while any pending
write for the organization remains. The removal itself scans every kind of
pending write (queued updates, deferred history tails, intents, attachment
uploads) and deletes under the same SQLite mutation lock, so no persisted write
can land between the check and the deletion. A recorded read failure with
nothing to upload is not pending work and never blocks it. An open document
store may also hold edits that have not reached SQLite yet: each store counts
every text, field, row, attachment, and rotation write from the call until it
persists, and the removal refuses while any of the organization's documents
has one.

The removal deletes the containers first and documents only after them. Each
document's deletion carries a commit guard that runs in the same synchronous
slice as its COMMIT: an edit queued while the rows were being deleted, or the
session switching into the organization, rolls that deletion back, and the
document stays as a detached local copy, like any document whose container
the device lost. When the guard passes at the COMMIT, it retires the
document's store in that same slice, so an open editor turns read-only before
the deletion commits; a COMMIT that then fails restores the store. Documents
already detached before the pause are never removed, since one may be the
only copy a recovery still needs. A retired store's sync lane stops and an
editor holding it sees a read-only stand-in, so nothing recreates or
downloads the document. Reopening keeps the stand-in while the organization
stays paused; after a resume, the next open rebinds it to a fresh backing
store that loads whatever SQLite holds. Each deletion also records the
document in `organization_sync_pause_removals`, in the same transaction, and a
store never recreates a recorded document, so reopening one after a restart
waits for the resume too; resuming the organization drops its records. A
device with pending or queued writes keeps them syncing out and retries the
removal each time its sync lanes go idle. Containers go in batches, and each batch
reads its documents in batches, so every statement stays within SQLite's bind
limit, all under the one lock.

Resuming forgets which containers the device had already listed, then
re-lists the whole tree and every container's documents, so the
organization's folders and documents download again. That listing queues
behind any sweep that started while the organization was paused rather than
joining it.

A personal organization cannot be paused: every device keeps its owner's root,
Contacts, and Trash there. The session's active organization is never skipped
or removed, even when another device paused it, because its root is the
session's workspace; the device removes it once the session switches away,
and Organizations offers to resume it meanwhile. Membership work runs one
operation at a time per scope and is bound to the scope it started in, so a
stale membership read cannot undo a newer choice or reach another identity's
data.

## Asking to leave

A member cannot remove themselves, so leaving is a request an administrator
acts on. The member signs `{organizationId, userId, requestedAt}` under the
`tearleads.organization-leave-request.v1` domain with their identity signing
key and files it with `PUT
/organization-memberships/{organizationId}/leave-request`; `DELETE` withdraws
it. The API checks that the request names the caller and the path's
organization, was signed within ten minutes, and verifies against the caller's
registered signing key; the window bounds how long a captured signature could
re-file a withdrawn request. It refuses a personal organization and a member
who is the organization's only administrator, since no one else could approve
the removal. Organizations offers to ask on every listed membership except the
personal one, and to withdraw once asked.

The request is stored on the member's roster row and reaches administrators in
the organization read model's `directory` lane, which the filing stamps. Only
administrators and the member themselves are served it; other members see the
roster entry without it. Because the lane's content depends on the viewer's
role, a change to `Admins` stamps the `directory` lane too, so a newly promoted
administrator's next delta carries pending requests. Each
administrator's client stores the request only if it names the organization
and member, and shows it only if it verifies against the member's trusted,
pinned identity, never the signing key served beside it, so a server cannot
present a request the member never made. Directory users a roster update
returns pass the same check, and a pinned identity verifies offline. Org
Manager shows the member as having asked to leave and offers to approve the
request.

Approving is the ordinary removal: the administrator signs the member out of
each group and then out of `Members`, rotating keys as any removal does.
Deactivating the roster entry clears the request along with the member's other
choices. Until then the member remains a full member and can withdraw.
