# Request budgets

App tests pin the [HTTP cost](./developer/api-request-cost.md) of each
user-visible operation: a total request ceiling, per-endpoint ceilings, the
exact number of committed mutations, and for the larger sharing fixtures,
request and response body bytes. The tests drive the real application, SDK and
test API, and each ceiling includes the background convergence that follows a
successful operation.

The ceilings are healthy-network fixture budgets with a few requests of
scheduling headroom. They are not retry limits or outage caps, and they do not
claim that larger organizations, paginated listings, larger attachments or
failures cost the same. Separate tests cover
[failure convergence](./sync-interruption-safety.md) and bounded retry.

## Measurement

`measureWorkflowRequests` ([`packages/app/test/helpers/workflowRequestBudget.ts`](../packages/app/test/helpers/workflowRequestBudget.ts))
waits for the pane runtime to settle, runs the operation, waits until every
expected mutation has committed with status 200, settles again, and then checks
the budget. [Local-first actions](./developer/device-first.md) can return before
their durable queue registers with the sync coordinator, so idle alone does not
prove a mutation completed. A `202`
[principal-history preparation](./principal-history-transport.md) response is
excluded from the count only when it validates and an identical request later
commits, and only up to the mutation's `maxPreparations` allowance.

`expectProxiedApiRequestBudget`
([`packages/app/test/helpers/proxiedApiRequestBudget.ts`](../packages/app/test/helpers/proxiedApiRequestBudget.ts))
compares the recorded requests with a `ProxiedApiRequestBudget`: a `total`,
`byRequest` ceilings keyed by method and route template (`POST
/documents/:documentId/sync`), and optional `bodyBytes` ceilings. The recorder
counts completed proxied HTTP calls and exact uncompressed body bytes, and
classifies each document sync as read-only or write-bearing from its
`outgoingUpdates`. Headers, WebSocket traffic, TLS, compression, network latency
and database CPU are outside the measurement.

To print per-phase profiles, build the SDK at the repository root with
`bun run --filter='@tearleads/client-sdk' build`, then run a budget test from
[`packages/app`](../packages/app/) with `DUAL_PANE_REQUEST_PROFILE=1`:

```sh
DUAL_PANE_REQUEST_PROFILE=1 DUAL_PANE_REQUEST_PROFILE_DETAIL=1 \
  bun test src/shell/pane/tests/DualPaneProvider.groupsRequestVolume.test.tsx
```

Each `[dual-pane-request-metrics]` line is JSON with the phase label, request
total, body bytes, sync intents, and per-endpoint counts and bytes.
`DUAL_PANE_REQUEST_PROFILE_DETAIL=1` also lists repeated exact paths. Byte
counts vary between runs with generated IDs, signatures, ciphertext and
timing-dependent projection paths, so profile several runs before changing a
ceiling.

## Operation budgets

Tests live in
[`packages/app/src/shell/pane/tests/`](../packages/app/src/shell/pane/tests/)
unless noted.

| Test | Operation | Request ceiling | Other pinned limits |
| --- | --- | ---: | --- |
| [`OrganizationBootstrapRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/OrganizationBootstrapRequestVolume.test.tsx) | Personal organization bootstrap: registration through Explorer showing Contacts, Trash and You | 21 | 5 document syncs (registration returns its commit position, so seeded documents skip empty first syncs), 2 parent-lane queries (a crawl lists every parent lane in one request), 3 batched document listings (the catch-up lists once more the lanes its tree crawl discovered), 1 container projection (the root's, for the Contacts create), 5 organization-policy and 2 history reads; provisioning seeds the destination roles of the containers it created; the device-first Contacts slot commits through its own create intent, which carries its first metadata update; no document projection, group-policy read or WebSocket ticket request; 280,000 request and 29,000 response bytes |
| [`OrganizationBootstrapRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/OrganizationBootstrapRequestVolume.test.tsx) | Create and activate an additional organization | 6 | One `POST /organizations`, one batched listing, one document sync; `POST /organizations` reports no commit position; no document projection or history read; 215,000 request and 20,000 response bytes |
| [`GroupMutationRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/GroupMutationRequestVolume.test.tsx) | Create the first / a later custom group | 9 / 7 | One group create and no read-model read: the create's response carries the read-model delta from the cursor the SDK held (the hint naming its cursor costs none); no preparation response, because each stored Admins head publishes its strict authority progress; the first create reads the roster profile container's projection and its Admins history, which bootstrap no longer reads |
| [`GroupMutationRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/GroupMutationRequestVolume.test.tsx) | Add a new peer to the first / a later custom group | 41 / 8 | One policy commit, whose response carries the read-model delta the SDK applies as its post-commit read, so a later add reads no read model; the first add enrolls the peer in Members in the same commit, a later add reuses that roster membership; no write-bearing syncs, and no create or sync of the organization profile, which provisioning (registration or organization creation) committed |
| [`GroupMutationRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/GroupMutationRequestVolume.test.tsx) | Create plus add, as one pair | 46 / 12 | At most 11 / 3 public history reads |
| [`FolderMutationRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/FolderMutationRequestVolume.test.tsx) | Create a child folder under a warm root | 3 | One create; its metadata rides the create, so no metadata sync; 31,100 request and 2,200 response bytes |
| [`FolderMutationRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/FolderMutationRequestVolume.test.tsx) | Link a document into the folder, keeping its root link | 2 | One link; no attachment listing, because the device holds no attachment row for the document; 9,300 request and 760 response bytes |
| [`FolderMutationRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/FolderMutationRequestVolume.test.tsx) | Unlink the document from the folder | 5 | One unlink, one document projection, one rotation-preflight sync that the replay reuses; no attachment listing; 17,650 request and 21,200 response bytes |
| [`FolderMutationRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/FolderMutationRequestVolume.test.tsx) | Move the document to Trash | 4 | One link and one unlink; the link cites no rewraps without listing and the unlink re-cites what the link committed; the first write into Trash reads its projection, and the unlink reuses the unchanged document's rotation proof, so no sync or document projection; 26,700 request and 8,900 response bytes |
| [`FolderMutationRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/FolderMutationRequestVolume.test.tsx) | Move the emptied folder to Trash | 10 | One move, no read-model read (an ungranted move stamps no grants); 16,700 request and 19,950 response bytes |
| [`FolderMutationRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/FolderMutationRequestVolume.test.tsx) | Restore the folder to the root | 11 | One move, no read-model read; 16,850 request and 33,000 response bytes (the root lane is listed twice in one tree request, from its watermark and for membership) |
| [`DualPaneProvider.groupsRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/DualPaneProvider.groupsRequestVolume.test.tsx) | Open Org Manager and select Admins | 3 | One read-model, one organization-policy and one Admins-policy read |
| [`DualPaneProvider.groupsRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/DualPaneProvider.groupsRequestVolume.test.tsx) | Add a new peer to Admins, including peer convergence | 49, plus each validated preparation response (at most one) | 132,000 request and 490,000 response bytes; 10 organization-policy, 3 group-policy and 7 history reads; no read-model read (the commit's response carries the actor's delta); 9 document projections (10 after a real stale-target `409`); 11 syncs, all read-only, none of the organization profile; 2 recitations; 1 policy commit; no standalone share |
| [`DualPaneProvider.sharing.test.tsx`](../packages/app/src/shell/pane/tests/DualPaneProvider.sharing.test.tsx) (root grant after attachment writes) | Create a folder and a note with an attachment, share the root with an active roster peer, and settle the peer's discovery; measured after provisioning and roster import | 55 | 104,700 request and 350,000 response bytes; 18 syncs (1-2 write-bearing, at most 16 read-only); 9 document projections; 4 parent-lane queries; 4 listings; no read-model read (the share's response carries the sharer's delta); 10 organization-policy reads; 4 recitations; 1 share |
| [`packages/app/src/mini-apps/explorer/ExplorerUploadRequestVolume.test.tsx`](../packages/app/src/mini-apps/explorer/ExplorerUploadRequestVolume.test.tsx) | Upload one small image from Explorer | 6 | One document create, one multipart stage, one part upload, one attachment binding that carries the first content update and acknowledges its KEK targets by hash, no sync; one organization-policy read shared by the create and the bind's sync drain; no per-part authorization or stage-completion request; 34,500 request and 2,300 response bytes, plus the bytes of the one allowed root projection read when it happens |
| [`DualPaneProvider.activePeerRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/DualPaneProvider.activePeerRequestVolume.test.tsx) | An active peer reconciles an ungranted custom-group change | Exactly 4 | One read-model read, two organization-policy reads and one group-policy read; no container or document request and no Admins-policy read |
| [`DeviceFirstOfflineRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/DeviceFirstOfflineRequestVolume.test.tsx) | Offline folder create, cached note edit, and move to Trash | 0 each | After reconnect the queued create, link and unlink commit |
| [`PaneRestartRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/PaneRestartRequestVolume.test.tsx) | Restart on the existing local database, server unchanged: the first restart after local creates / a later one / the first after a local edit | 19 / 11 / 13 | Two user folders; fresh SDK and SQLite worker; no replayed writes; the later restart costs at most 11 with two notes, with eight notes, and with eight folders |
| [`PaneReconnectRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/PaneReconnectRequestVolume.test.tsx) | Reconnect without pending work / after one peer folder create | 12 / 18 | Disconnect costs zero; one WebSocket ticket, one memberships read and one tree crawl each; no write-bearing syncs |

[`DualPaneProvider.sidebarReloadBudget.test.tsx`](../packages/app/src/shell/pane/tests/DualPaneProvider.sidebarReloadBudget.test.tsx)
bounds document link projection changes during cold bootstrap.

Most policy reads in these budgets come from private metadata-root authority:
each workflow operation reads the server-current
[organization policy](./glossary/principals.md#principal-policy-state) once, and
a [head](./glossary/sync.md#head) new to the device needs its first read. See
[current-policy request costs](developer/current-principal-consumers.md#request-costs)
and [principal-history acceptance](principal-history-acceptance.md) for that
security tradeoff.

## Organization creation retries

An ordinary create persists its signed request before sending `POST /organizations`.
After a lost response, identical user and creation inputs resume that request,
including after SQLite reopens. A matching server receipt adopts the original
organization instead of creating another. Local acknowledgement completes the
attempt atomically with bootstrap; a later identical create is then a new operation.

Discovery can expose the root before acknowledgement. That does not complete
or abandon the attempt: the next identical create is still a retry and must
preserve newer local state. A later HTTP rejection cannot disprove an earlier
commit, so attempts do not expire automatically. Generic 400/409 failures,
disabled or removed membership, missing billing and scheduled deletion retain
the attempt: those states do not prove irreversible loss.

Only a validated `410 organization_creation_purged` releases the exact pending
attempt. The server first verifies the current signer and the stored user and
full-request hash, then certifies irreversible purge. The SDK returns failure
without sending another POST; the next deliberate create can start a fresh
operation. Purge discards the retained bootstrap response, keeping its binding
metadata for that refusal. See the
[terminal-replay regression](../packages/api/src/routes/organizations/createOrganization.terminalReplay.test.ts).

The intent includes identity keys, names and system-container specifications.
Changed inputs start a different intent, not a retry; a host upgrade changing
those inputs can leave the previous attempt pending. Other permanently unusable
artifacts can also remain pending; no public cancellation or expiry is provided.
Prechange local tables and API databases require the greenfield reset; backup
format 16 rejects backups that can restore the obsolete provisioning table.
See the
[lost-response regression](../packages/api/src/routes/organizations/createOrganization.lostResponse.test.ts).

## Restart and reconnect

These fixtures start with one personal organization, two user folders and one
note in each, in addition to its system containers and self contact. Setup and
all writes finish before measurement. The restart slice mounts a new pane and
opens Explorer at the root; the reconnect slices keep Explorer mounted at the
root. They measure completed HTTP calls, not WebSocket frames or a real socket
server's CPU: the app uses the suite's MSW interest/acknowledgement transport
twin and the real proxied test API.

The restart and unchanged reconnect use one pane with the `app` host profile
and shared runtime policy. The peer-create case uses two panes with the `demo`
profile, isolated runtimes and peer-sharing features enabled, but no demo
identity seeding. These are distinct fixtures: the difference between 12 and
18 is not a measured incremental cost of creating one folder.

The restart closes the SQLite connection, terminates its worker and disposes
the SDK before mounting another instance with the persisted identity/session
and the same SQLite backing file. A local-only SQL sentinel proves the database
was reopened, not rebuilt from server responses. The backing file is in the
test SQLite WASM VFS, not browser OPFS: this covers a pane/runtime restart, not
an operating-system process restart or browser persistence durability.

Reconnect uses Force Offline then Automatic Network, with no offline intents.
It waits for a new acknowledged connection generation and the actual
reconciliation promise started by that acknowledgement; it never calls an
extra refresh to make the test converge. A network-quiet interval alone can end
between the sweep's requests. The peer case creates one folder in another pane
using a distinct session of the same identity and an independent local database
while the observer is disconnected. The create and peer convergence are outside
the measured window; every request inside it belongs to the observer, which
must discover the previously absent folder.

The measured baseline counts below are also the enforced per-route ceilings.
They are upper bounds, not equality assertions: a reduction passes and should
be remeasured and documented when an optimization changes the baseline.

| Method and route | First restart | Settled restart | Reconnect unchanged | Reconnect after peer create |
| --- | ---: | ---: | ---: | ---: |
| `POST /auth/ws-ticket` | 1 | 1 | 1 | 1 |
| `GET /organization-memberships` | 1 | 1 | 1 | 1 |
| `GET /organizations/:organizationId/billing` | 1 | 1 | 0 | 0 |
| `POST /containers/parent-lanes/query` | 1 | 1 | 1 | 2 |
| `POST /containers/documents/query` | 3 | 2 | 1 | 2 |
| `GET /principals/organization/:organizationId/policy` | 2 | 1 | 2 | 3 |
| `GET /principals/group/:groupId/policy` | 0 | 0 | 0 | 0 |
| `GET /principals/history` | 1 | 0 | 0 | 0 |
| `GET /containers/:containerId/writer-projection` | 3 | 2 | 1 | 2 |
| `GET /documents/:documentId/writer-projection` | 3 | 0 | 3 | 4 |
| `POST /documents/:documentId/sync` (all read-only) | 3 | 2 | 2 | 3 |
| **Total** | **19** | **11** | **12** | **18** |

No note is synced in any column. A listing
[covers each note](./document-listing-coverage.md): its row carries the
document's update count, and a note whose count the device's cursor covers
owes no read. The syncs that remain are system-container documents, which are
pulled once per launch, and one probe for a document no listing names.

The first restart is the first launch after the notes were created. Their
lanes list the rows those creates published, and each listed row's head is
verified with one document writer-projection read. The settled restart is
every launch after that: the tree crawl is served no folder's row, so the
catch-up after the acknowledgement lists no document lane at all, and the cost
is the same with two notes and with eight, which the canary runs at both
sizes. Its two listing requests are one batch of queued lanes and one
unwatermarked batch for the initial document probe, which reads up to 32 lanes
per request. A third size, eight folders of one note each, costs no more: the
tree crawl lists the root lane and each known folder's child lane, up to 32
parent lanes per request, so it is one request here too. The first restart
after a local edit is served the edited note's folder, whose lane the catch-up
then lists: one more listing and one more policy read than a settled restart;
the note is not synced and its head is not read, because the device's own
accepted update is behind its cursor.

A connect costs one tree crawl. Going online starts a crawl, and so does the
interest acknowledgement that follows, which must list after the
acknowledgement because hints sent before it are lost. The first crawl
therefore gives way: it does not start while a connect attempt is pending,
and it is neither started nor retried while the crawl of a current
acknowledgement is owed. If the attempt ends without an acknowledgement, the
first crawl lists. It waits without holding the store's hydration slot, so a
refresh or a write's follow-up crawl made meanwhile lists at once. Before, a
reconnect listed the tree twice. A crawl costs one request for every 32
lanes; a lane with more children than its share of the 500-row page, 15 in a
full batch, continues in a later request.

Before listings covered documents, every opened document probed once per
session: the first restart cost 23 requests with two notes and 35 with eight,
one sync and one document writer-projection read for each extra note.

Each canary also rejects data mutations and non-200 responses, checks for
delayed follow-up traffic before other UI actions, and tears down the pane.
These are baselines, not claimed optimizations or outage/retry limits.

## Design decisions

These choices keep request counts above the minimum on purpose.

### Authoritative reconciliation

Realtime events are [volatile hints](./developer/realtime-hints.md). Interest
routes them to the right lanes but grants no access, and a hint can be lost.
Recovery therefore comes from authoritative reconciliation
([`packages/client-sdk/src/sync/reconciliation/`](../packages/client-sdk/src/sync/reconciliation/)),
not from replaying a durable delta log, which would need its own replay
authorization, atomic event durability, retention, acknowledgements and ordered
local application.

- Initial hydration discovers authorized parent and document lanes. The initial
  missing-document probe reuses a completed unwatermarked discovery listing
  only after every page and its local persistence succeed, for the same probe
  generation and container; incremental, partial or earlier-lifecycle listings
  cannot substitute for it.
- A start whose connection is never acknowledged lists only the document
  lanes an earlier boot left
  [owed](./developer/device-first.md#owed-document-lanes): never settled by
  an applied listing, or holding staged candidates. The reconciler lists up
  to four lanes per batched request, so a reload that cuts discovery short
  costs one listing per four owed lanes at the next start, and a settled lane
  costs nothing. A start whose connect attempt is still pending at hydration
  does not resume: if the attempt is acknowledged, the catch-up below lists
  every owed lane, and the resume never runs. The resume runs
  when no attempt is pending at hydration, or when the attempt ends without an
  acknowledgement (the socket opens before the tree can declare its interest,
  or no acknowledgement arrives within 15 seconds) or is replaced by a new
  one. A connection that starts or is acknowledged after that, the
  replacement included, is a new catch-up: it lists the lanes still owed and
  the lanes its tree crawl is served.
- Upgrading costs at least one full listing. Devices that ran earlier
  releases have no settled mark on any document lane, so every known lane
  starts owed, and the first start after the upgrade lists all of them, four
  lanes per request, in the resume or the catch-up, or in both when a
  connection is acknowledged after the resume ran. That listing also repairs
  devices whose sign-in boot was cut short. A lane the server refuses never
  settles, so it stays owed and is listed again on every start. The release
  that made the catch-up list only the lanes its tree crawl showed moved
  costs one more: a local migration marks every document lane unsettled once,
  because an earlier catch-up listed every lane and recorded none as owed.
- Scoped hints force the affected lanes, including the parent lane needed to
  remove a nested revoked or deleted child. Newer force generations survive
  older completions, and temporary failures keep the force with bounded
  automatic retries.
- A reconnect drops cached
  [writer projections](./glossary/sync.md#writer-projection) and installs and
  acknowledges the current interest set
  ([`packages/app/src/providers/sdk/serverEventsBinding.ts`](../packages/app/src/providers/sdk/serverEventsBinding.ts)).
  The acknowledgement advances the connection generation, and the SDK then
  re-lists the tree and each document lane whose container that listing was
  served ([which lanes a catch-up lists](./document-listing-coverage.md#which-lanes-a-catch-up-lists)),
  on a first connection as on a reconnect.
  Distinct login sessions of the same identity receive each other's events.
  An organization read-model hint carries the committed cursor instead of a
  session origin, so each client reads only when that cursor is ahead of the
  one its projection applied: the author's echo of its own post-mutation read
  or committed delta costs nothing, and a sibling client still refreshes.
- Explicit Refresh or Sync is a recovery signal and probes every registered
  document. While the scope can sync, the device-first scope opens every
  discovered document of an unpaused organization in the background. An
  opened document probes on startup or acknowledged reconnect only when no
  listing covers it; otherwise the listing after the acknowledgement owes a
  read to each document whose update count the device's cursor does not
  cover ([document listing coverage](./document-listing-coverage.md)). System
  projections are eager.
- A held container whose listed metadata update count this device's
  processed cursor does not cover owes its metadata document one read, so a
  lost metadata hint is
  recovered at the next reconnect, restart or refresh
  ([container metadata under lost hints](./client-sync-ordering.md#container-metadata-under-lost-hints)).
  A listing whose metadata nobody else edited owes none, nor does one whose
  only new updates this device voided, so the budgets below are unchanged.

There is no periodic full-tree sweep on a healthy socket: a lost hint waits for
another relevant signal, reconnect, startup or explicit refresh. Server
authorization and cryptographic checks stay authoritative meanwhile; a cached
view is not proof of continuing remote write access.

### Singular document sync, batched listing

Document sync stays one bounded request per document, with independent
authorization, structural ordering, and per-document `409` and retry behavior.
Batching sync probes would cut HTTP calls without showing less database or
cryptographic work. Listing is batched instead:
`POST /containers/documents/query` lists up to 32
[container](./glossary/access.md#container) lanes
(`MAX_CONTAINER_DOCUMENT_LANES`) per request, each through the singular listing
with its own readable-container gate, access resolver, watermark and page bound.
The lanes share one request-scoped cache of verified principal policies by
reference, and a lane's linked containers reuse the policies its gate loaded, so
batching also saves statements; every
[container path](./glossary/access.md#authorizing-container-path) is still verified.
`POST /containers/parent-lanes/query` accepts 32 parent lanes
(`MAX_CONTAINER_PARENT_LANES`) on the same terms. Both routes list four lanes
at a time, the size of the request's
[database pool](./limits.md#database-connections), so a larger batch does not
hold more database work at once than four singular listings did. A document
listing pinned to a parent page (`afterParentPage`) lists one lane at a time,
inside one read-only transaction.

### Separate projection reads

Container and document writer projections stay separate, independently
verified reads rather than being inlined into listings. Listing rows and access
resolution do not share a transaction snapshot, and inlining would need new
snapshot, response-size, verification and cache-race rules and would duplicate
signed paths. Projection reads instead cite
[manifest](./glossary/access.md#access-manifest) bundles the device already
holds; see [the incremental evidence contract](projection-policy-evidence.md#cost-and-retained-history-tradeoff).

### Current policy before signed mutations

Group creation and membership changes spend most of their requests reading
policy heads. Their
[organization read model](./glossary/principals.md#organization-read-model)
refresh rides the mutation's response as a
[committed delta](./organization-read-model-sync.md#committed-deltas). The
policy reads feed signed compare-and-swap mutations, so reusing stale
authorization state to save them is not an option. Unlinking a document reads a
current writer projection and runs one rotation-preflight sync; the queued
unlink's replay reuses that proof while the document is unchanged, because the
server refuses a baseline that misses a committed update with
`409 document_unlink_rotation_baseline_stale` and the replay then proves again.
Dropping the projection or the first proof would need another proof that the
client holds current authorization and complete history. Moving a document to
Trash is a [durable link-then-unlink workflow](./developer/document-links.md):
an outage can briefly leave both links present, and a retry completes the
remaining leg.
