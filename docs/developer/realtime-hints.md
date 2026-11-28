# Realtime hint privacy

[Realtime hints](../glossary/sync.md#realtime-hint) request HTTP refreshes; they
do not establish content or access. The gateway routes
[container](../glossary/access.md#container) and document hints by subtree
coverage: each published event carries server-only verified ancestor paths, and
the router delivers a frame to sockets that hold a current proof for the target
container or any container on its published path, then reconstructs the outgoing
frame from the public schema so path metadata and authoring session never cross
the websocket boundary. Events published without path metadata fail closed and
match only sockets holding the target container itself.

Interest belongs to one open socket. A socket opens with no container interest
and the server sends nothing on open; the client declares its authoritative
`known_containers` set once its local tree is ready, and the gateway indexes
only the subset `containerInterestAuthorization` verifies. No server-side copy
of a socket's interest outlives it, so a reconnecting socket, or another tab on
the same session, receives no container hint until its own declaration is
installed. Hints published before a root is installed are still recovered by the
client: `known_containers_ack` follows installation, and the client reconciles
over HTTP after that acknowledgement (see
[client sync ordering](../client-sync-ordering.md#remote-pull-eligibility)).

- A socket can receive a frame naming a container its client has not listed yet
  when that container sits under a declared root. Access only grows going down a
  path, so the user is authorized to read that container.
- A watcher covering the mutated container receives `container_mutation_created`
  with its id and event type. Parent ids appear only when that socket covers
  them; a null parent denotes the [root](../glossary/access.md#root-container).
  The SDK re-lists the container's lane and each parent the frame names. It
  re-lists the root lane only when the frame names root, withholds an existing
  container's parent (or a move's source), or carries a grant or revoke: the
  root lane lists directly granted nested containers, and no other event
  changes direct grants.
- A watcher covering only the source parent of a move out of coverage (or the
  parent of a deleted child) receives `container_children_changed` naming only
  that parent id. That frame carries no child id, event type, other parent id,
  author session, or mutation timestamp. A parent watcher whose child stays
  inside coverage receives the full `container_mutation_created` frame instead.
  The SDK clears cached projections for those parents and known descendants,
  then refreshes the parent listings and root lane. HTTP
  [access checks](../access-plane.md#read-surfaces) determine which children
  it can discover.
- A previously authorized watcher evicted by a move, delete, or revoke receives
  `resync_required` naming the installed root ids it previously held. The SDK
  drops those containers' and their known descendants' cached projections, plus
  open document projections, before HTTP revalidation. If it still covers a
  source parent, its later parent hint uses `container_children_changed` above.
- Descendant watchers retain `container_path_changed` for their own dependent
  installed roots; this does not reveal the mutated ancestor.
- **Stale-path window across concurrent moves**: a hint whose publisher read its
  path before a move committed can arrive at the hub after the move event. The
  hub remembers each moved container's new ancestor ids for a short window (60
  seconds) and rewrites any later hint carrying a different prefix for that
  container or its descendants to the remembered path. Only hints that reach the
  hub ahead of the move event itself can still route under the pre-move path,
  matching the pre-existing event ordering bound: inside that window the socket
  learns only that a container it could read a moment ago changed, learns no new
  id, and any HTTP read it triggers is access-checked.

A parent refresh still reveals that something changed and when the notification
arrived. This contract minimizes event details; it does not hide traffic timing.

SDK hosts must forward `resync_required` into `tearleads.events` with a fresh
local event `id` and the frame's `containerIds` before starting HTTP refreshes.
The app binding does this in `resyncContainerAccess`. Refreshing HTTP caches alone
does not invalidate projections held by open document stores.

A generic parent hint invalidates the parent's entire known subtree, including
unaffected siblings. It also refreshes the root lane to cover moves that occurred
before a child's interest was confirmed. This trades extra reads and cache misses
for concealing child identity; a folder move may require two listing requests.

## Organization read-model hints

An organization read-model hint goes only to sockets whose declared
organization interest the gateway authorized and whose user is in the
committed change's active-roster audience. The frame
`{type, organizationId, cursor}` names the organization and the committed
opaque read-model cursor. That cursor is the `nextCursor` every recipient
already reads over HTTP, so it reveals nothing beyond the change timing the
hint itself carries; recipient ids and the authoring session never cross the
socket. The client reads only when the cursor is ahead of the cursor its
projection applied (see
[organization read-model sync](../organization-read-model-sync.md#realtime-behavior)).
A user who leaves the audience receives one cursorless
`organization_read_model_access_revoked` instead.

## Cloudflare hub hibernation

`RealtimeHub` accepts sockets through Cloudflare's hibernation API. Each socket
carries a small server-written attachment containing its identity and storage
key. The hub's SQLite storage holds that socket's verified container dependency
paths, organization declaration, session confirmation time, and next check
schedule. Large snapshots are chunked below SQLite's per-value limit. The
snapshot serves only a socket that stays connected across eviction; a new
connection starts empty and declares its own interest.

Every entry point restores all connected sockets before routing, including an
HTTP publish that wakes an idle hub. Restoration preserves absolute proof and
session deadlines and runs overdue callbacks before the waking event can route.
It does not consume another ticket, send any frame, or extend authorization
merely because the object woke up. A missing snapshot closes its socket so the
client reconnects through fresh authorization.

One durable alarm schedules the earliest periodic check or expiry. While an
event is awaiting I/O, a temporary timer also enforces deadlines independently
of that event; the last completed event cancels it. No idle JavaScript timer or
database pool keeps the hub resident. Event completion saves changed socket
state, updates the alarm, and closes its database pool. Ordinary hints do not
serialize unchanged snapshots. HTTP publications acknowledge completed routing
while `waitUntil` owns trailing checks and cleanup, so unrelated slow rechecks
do not delay the caller. Closing a socket removes its state, and a restored hub
prunes abandoned rows. Publication failures are reported but remain best
effort, so a failed wake-up cannot fail a committed mutation.

A new connection completes its upgrade without reading any interest: socket
setup registers it with an empty interest set, and its first declaration pays
the authorization query. Fatal socket setup errors close the accepted
connection for a fresh retry. HTTP publications also pay cold restoration
cost; organization events await bounded authorization (up to ten seconds)
before routing. Unrelated periodic checks remain in the trailing phase.

Cloudflare's [state API](https://developers.cloudflare.com/durable-objects/api/state/#waituntil)
documents that `waitUntil` prevents eviction until completion, up to fifteen
minutes. Every event also retains its temporary deadline timer until cleanup.

`bun run test:postgres-concurrency` runs
[`packages/api/src/worker/workerRuntime.hibernation.pg.test.ts`](../../packages/api/src/worker/workerRuntime.hibernation.pg.test.ts)
against the real Worker configuration through Wrangler's test harness. It evicts
the object while retaining sockets, exercises publication and logout after
wake-up, checks distinct per-tab interest, and proves a durable alarm detects
session expiry without a revocation notification. It also verifies that expired
proofs cannot route the event that wakes the hub. Test control endpoints live in
a separate local-only helper Worker, outside the deployed API entry point.
