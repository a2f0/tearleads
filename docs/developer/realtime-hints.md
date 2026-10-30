# Realtime hint privacy

Realtime hints request HTTP refreshes; they do not establish content or access.
The gateway routes container mutations to watchers of the container and its
current and previous parents, then constructs a frame for each recipient's
verified interests.

Interest belongs to one open socket. A socket opens with no container interest
and the server sends nothing on open; the client declares its authoritative
`known_containers` set once its local tree is ready, and the gateway indexes
only the subset `containerInterestAuthorization` verifies. No server-side copy
of a socket's interest outlives it, so a reconnecting socket, or another tab on
the same session, receives no container hint until its own declaration is
installed. Hints published before then are recovered by the client:
`known_containers_ack` follows installation, and the client reconciles over
HTTP after that acknowledgement (see
[client sync ordering](../client-sync-ordering.md#remote-pull-eligibility)).

- A watcher of the mutated container receives `container_mutation_created` with
  its id and event type. Parent ids appear only when that socket watches them;
  a null parent denotes the root.
- A parent-only watcher receives `container_children_changed` with only the
  parent ids it watches. That frame carries no child id, event type, other
  parent id, author session, or mutation timestamp. The SDK clears cached
  projections for those parents and known descendants, then refreshes the parent
  listings and root lane. This also covers a known child whose own interest is
  still awaiting confirmation. HTTP access checks determine which children it
  can discover.
- A previously authorized child watcher evicted by a move or revoke receives
  `resync_required` naming the ids it previously held. The SDK drops those
  containers' and their known descendants' cached projections, plus open document
  projections, before HTTP revalidation. If it still watches a parent, its later
  parent hint uses the generic frame above.
- Descendant watchers retain `container_path_changed` for their own dependent
  paths; this does not reveal the mutated ancestor.

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
