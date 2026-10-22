# Organization memberships

A user's membership in an organization is decided by signed principal policy:
the reserved `Members` group, any other groups they belong to, and the
container grants those groups hold. Leaving or being removed therefore needs
an administrator to sign a new `Members` state and rotate its keys. A member
cannot do that for themselves.

The membership conduit is the member's own side of the relationship: product
state the member controls, which never feeds an access or keying decision.
It lives on the member's `organization_roster_entries` row, which already
exists for every active or disabled roster member.

## Discovering organizations

Every `Members` recipient can read the organization's metadata root, an
independent system container holding the organization profile and group
names. A device therefore learns about an organization from local state alone:
`listLocalOrganizations` lists every organization the device holds a container
of, with `rootContainerId` null when the user cannot reach the organization's
workspace root. The Organizations mini-app shows each one with the folders the
user can reach in it, the containers whose parent is not on the device. The
Org Manager switcher still lists only workspaces, because activating an
organization makes its root the session container.

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
- treats its stored containers as unlisted for document discovery;
- keeps only the organization's metadata root, a parentless system container,
  so the organization stays named and its membership visible;
- removes the rest of its local copy: every other container of the
  organization and every document placed only in those containers.

Removal waits for the organization's local writes to upload. Pausing from a
device first asks every sync lane to upload and is refused while any pending
write for the organization remains. The removal itself scans every kind of
pending write (queued updates, deferred history tails, intents, attachment
uploads) and deletes under the same SQLite mutation lock, so no persisted write
can land between the check and the deletion. It deletes the containers first
and documents only after them. A document an open store holds this session may
carry edits that have not reached SQLite, so it is never deleted: it stays
detached, still attributed to the organization, until a later pass finds no
store holding it. A device that still has pending writes keeps them syncing
out and retries the removal each time its sync lanes go idle. Resuming
re-lists the whole tree with fresh lane watermarks so the organization
downloads again.

A personal organization cannot be paused: every device keeps its owner's root,
Contacts, and Trash there. The session's active organization is never skipped
or removed, even when another device paused it, because its root is the
session's workspace; the device removes it once the session switches away,
and Organizations offers to resume it meanwhile. Membership work runs one
operation at a time per scope and is bound to the scope it started in, so a
stale membership read cannot undo a newer choice or reach another identity's
data.
