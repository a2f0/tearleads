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
| [`OrganizationBootstrapRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/OrganizationBootstrapRequestVolume.test.tsx) | Personal organization bootstrap: registration through Explorer showing Contacts, Trash and You | 27 | 7 document syncs, 5 parent-lane queries, 2 batched document listings, 1 container projection (the root's, for the Contacts create), 5 organization-policy and 2 history reads; provisioning seeds the destination roles of the containers it created; the device-first Contacts slot commits through its own create intent, which carries its first metadata update; no document projection, group-policy read or WebSocket ticket request; 320,000 request and 47,000 response bytes |
| [`OrganizationBootstrapRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/OrganizationBootstrapRequestVolume.test.tsx) | Create and activate an additional organization | 6 | One `POST /organizations`, one batched listing, one document sync; no document projection or history read; 245,000 request and 20,000 response bytes |
| [`GroupMutationRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/GroupMutationRequestVolume.test.tsx) | Create the first / a later custom group | 11 / 8 | One group create, one read-model read (the hint naming its cursor costs none), plus at most one validated preparation response; the first create reads the roster profile container's projection and its Admins history, which bootstrap no longer reads |
| [`GroupMutationRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/GroupMutationRequestVolume.test.tsx) | Add a new peer to the first / a later custom group | 43 / 9 | One policy commit, applying the SDK's post-commit read model without a second read; the first add enrolls the peer in Members in the same commit, a later add reuses that roster membership; no write-bearing syncs |
| [`GroupMutationRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/GroupMutationRequestVolume.test.tsx) | Create plus add, as one pair | 50 / 14 | At most 11 / 3 public history reads |
| [`FolderMutationRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/FolderMutationRequestVolume.test.tsx) | Create a child folder under a warm root | 3 | One create; its metadata rides the create, so no metadata sync; 36,000 request and 2,000 response bytes |
| [`FolderMutationRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/FolderMutationRequestVolume.test.tsx) | Link a document into the folder, keeping its root link | 3 | One link; 10,500 request and 700 response bytes |
| [`FolderMutationRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/FolderMutationRequestVolume.test.tsx) | Unlink the document from the folder | 6 | One unlink, one document projection, one rotation-preflight sync that the replay reuses; 20,000 request and 33,000 response bytes |
| [`FolderMutationRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/FolderMutationRequestVolume.test.tsx) | Move the document to Trash | 5 | One link and one unlink, sharing one attachment listing; the first write into Trash reads its projection, and the unlink reuses the unchanged document's rotation proof, so no sync or document projection; 30,000 request and 25,000 response bytes |
| [`FolderMutationRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/FolderMutationRequestVolume.test.tsx) | Move the emptied folder to Trash | 10 | One move, no read-model read (an ungranted move stamps no grants); 18,500 request and 45,000 response bytes |
| [`FolderMutationRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/FolderMutationRequestVolume.test.tsx) | Restore the folder to the root | 11 | One move, no read-model read; 18,500 request and 59,000 response bytes |
| [`DualPaneProvider.groupsRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/DualPaneProvider.groupsRequestVolume.test.tsx) | Open Org Manager and select Admins | 3 | One read-model, one organization-policy and one Admins-policy read |
| [`DualPaneProvider.groupsRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/DualPaneProvider.groupsRequestVolume.test.tsx) | Add a new peer to Admins, including peer convergence | 51, plus each validated preparation response (at most one) | 160,000 request and 595,000 response bytes; 10 organization-policy, 3 group-policy and 7 history reads; 3 read-model reads; 9 document projections (10 after a real stale-target `409`); 12 syncs, all read-only; 2 recitations; 1 policy commit; no standalone share |
| [`DualPaneProvider.sharing.test.tsx`](../packages/app/src/shell/pane/tests/DualPaneProvider.sharing.test.tsx) (root grant after attachment writes) | Create a folder and a note with an attachment, share the root with an active roster peer, and settle the peer's discovery; measured after provisioning and roster import | 56 | 128,000 request and 440,000 response bytes; 18 syncs (1-2 write-bearing, at most 16 read-only); 9 document projections; 11 parent-lane queries; 4 listings; 3 read-model reads; 10 organization-policy reads; 4 recitations; 1 share |
| [`packages/app/src/mini-apps/explorer/ExplorerUploadRequestVolume.test.tsx`](../packages/app/src/mini-apps/explorer/ExplorerUploadRequestVolume.test.tsx) | Upload one small image from Explorer | 6 | One document create, one multipart stage, one part upload, one attachment binding that carries the first content update and acknowledges its KEK targets by hash, no sync; one organization-policy read shared by the create and the bind's sync drain; no per-part authorization or stage-completion request; 38,000 request and 2,300 response bytes, plus the bytes of the one allowed root projection read when it happens |
| [`DualPaneProvider.activePeerRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/DualPaneProvider.activePeerRequestVolume.test.tsx) | An active peer reconciles an ungranted custom-group change | Exactly 4 | One read-model read, two organization-policy reads and one group-policy read; no container or document request and no Admins-policy read |
| [`DeviceFirstOfflineRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/DeviceFirstOfflineRequestVolume.test.tsx) | Offline folder create, cached note edit, and move to Trash | 0 each | After reconnect the queued create, link and unlink commit |
| [`PaneRestartRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/PaneRestartRequestVolume.test.tsx) | Restart on the existing local database, server unchanged | 23 | Two user folders and two notes; fresh SDK and SQLite worker; no replayed writes |
| [`PaneReconnectRequestVolume.test.tsx`](../packages/app/src/shell/pane/tests/PaneReconnectRequestVolume.test.tsx) | Reconnect without pending work / after one peer folder create | 22 / 30 | Disconnect costs zero; one WebSocket ticket and one memberships read each; no write-bearing syncs |

[`DualPaneProvider.sidebarReloadBudget.test.tsx`](../packages/app/src/shell/pane/tests/DualPaneProvider.sidebarReloadBudget.test.tsx)
budgets local sidebar reload passes during cold bootstrap, not HTTP requests.

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
commit, so attempts do not expire automatically. Permanently unusable artifacts
can remain pending; no public cancellation operation is provided. See the
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
identity seeding. These are distinct fixtures: the difference between 22 and
30 is not a measured incremental cost of creating one folder.

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

| Method and route | Restart | Reconnect unchanged | Reconnect after peer create |
| --- | ---: | ---: | ---: |
| `POST /auth/ws-ticket` | 1 | 1 | 1 |
| `GET /organization-memberships` | 1 | 1 | 1 |
| `GET /organizations/:organizationId/billing` | 1 | 0 | 0 |
| `POST /containers/parent-lanes/query` | 2 | 4 | 6 |
| `POST /containers/documents/query` | 3 | 1 | 2 |
| `GET /principals/organization/:organizationId/policy` | 2 | 3 | 5 |
| `GET /principals/group/:groupId/policy` | 0 | 0 | 0 |
| `GET /principals/history` | 1 | 0 | 0 |
| `GET /containers/:containerId/writer-projection` | 3 | 1 | 2 |
| `GET /documents/:documentId/writer-projection` | 3 | 3 | 4 |
| `POST /documents/:documentId/sync` (all read-only) | 6 | 8 | 9 |
| **Total** | **23** | **22** | **30** |

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
- Scoped hints force the affected lanes, including the parent lane needed to
  remove a nested revoked or deleted child. Newer force generations survive
  older completions, and temporary failures keep the force with bounded
  automatic retries.
- A reconnect drops cached
  [writer projections](./glossary/sync.md#writer-projection), installs and
  acknowledges the current interest set, and then runs reconciliation
  ([`packages/app/src/providers/sdk/serverEventsBinding.ts`](../packages/app/src/providers/sdk/serverEventsBinding.ts)).
  Distinct login sessions of the same identity receive each other's events.
  An organization read-model hint carries the committed cursor instead of a
  session origin, so each client reads only when that cursor is ahead of the
  one its projection applied: the author's echo of its own post-mutation read
  costs nothing, and a sibling client still refreshes.
- Explicit Refresh or Sync is a recovery signal. Opened documents probe on
  startup, acknowledged reconnect or forced invalidation; unopened ordinary
  documents stay lazy, and system projections are eager.

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
policy heads and refreshing the
[organization read model](./glossary/principals.md#organization-read-model).
Those reads feed signed compare-and-swap mutations, so reusing stale
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
