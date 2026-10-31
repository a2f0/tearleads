# Request budgets

App tests pin the HTTP cost of each user-visible operation: a total request
ceiling, per-endpoint ceilings, the exact number of committed mutations, and
for the larger sharing fixtures, request and response body bytes. The tests
drive the real application, SDK and test API, and each ceiling includes the
background convergence that follows a successful operation.

The ceilings are healthy-network fixture budgets with a few requests of
scheduling headroom. They are not retry limits or outage caps, and they do not
claim that larger organizations, paginated listings, larger attachments or
failures cost the same. Separate tests cover failure convergence and bounded
retry.

## Measurement

`measureWorkflowRequests` ([`packages/app/test/helpers/workflowRequestBudget.ts`](../packages/app/test/helpers/workflowRequestBudget.ts))
waits for the pane runtime to settle, runs the operation, waits until every
expected mutation has committed with status 200, settles again, and then checks
the budget. Local-first actions can return before their durable queue
registers with the sync coordinator, so idle alone does not prove a mutation
completed. A `202` principal-history preparation response is excluded from the
count only when it validates and an identical request later commits, and only
up to the mutation's `maxPreparations` allowance.

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
| `OrganizationBootstrapRequestVolume.test.tsx` | Personal organization bootstrap: registration through Explorer showing Contacts, Trash and You | 32 | 7 document syncs, 5 parent-lane queries, 2 batched document listings, 4 container projections, 6 organization-policy and 3 history reads; no document projection, group-policy read or WebSocket ticket request; 355,000 request and 175,000 response bytes |
| `OrganizationBootstrapRequestVolume.test.tsx` | Create and activate an additional organization | 6 | One `POST /organizations`, one batched listing, one document sync; no document projection or history read; 254,000 request and 25,000 response bytes |
| `GroupMutationRequestVolume.test.tsx` | Create the first / a later custom group | 10 / 9 | One group create, plus at most one validated preparation response |
| `GroupMutationRequestVolume.test.tsx` | Add a new peer to the first / a later custom group | 45 / 11 | One policy commit; the first add enrolls the peer in Members in the same commit, a later add reuses that roster membership; no write-bearing syncs |
| `GroupMutationRequestVolume.test.tsx` | Create plus add, as one pair | 53 / 17 | At most 11 / 3 public history reads |
| `FolderMutationRequestVolume.test.tsx` | Create a child folder under a warm root | 3 | One create; its metadata rides the create, so no metadata sync |
| `FolderMutationRequestVolume.test.tsx` | Link a document into the folder, keeping its root link | 3 | One link |
| `FolderMutationRequestVolume.test.tsx` | Unlink the document from the folder | 8 | One unlink, one document projection, two syncs |
| `FolderMutationRequestVolume.test.tsx` | Move the document to Trash | 10 | One link and one unlink |
| `FolderMutationRequestVolume.test.tsx` | Move the emptied folder to Trash | 12 | One move |
| `FolderMutationRequestVolume.test.tsx` | Restore the folder to the root | 13 | One move; 23,000 request and 110,000 response bytes |
| `DualPaneProvider.groupsRequestVolume.test.tsx` | Open Org Manager and select Admins | 3 | One read-model, one organization-policy and one Admins-policy read |
| `DualPaneProvider.groupsRequestVolume.test.tsx` | Add a new peer to Admins, including peer convergence | 76, plus each validated preparation response (at most one) | 160,000 request and 740,000 response bytes; 20 organization-policy, 3 group-policy and 7 history reads; 9 document projections (10 after a real stale-target `409`); 12 syncs, all read-only; 2 recitations; 1 policy commit; no standalone share |
| `DualPaneProvider.sharing.test.tsx` (root grant after attachment writes) | Create a folder and a note with an attachment, share the root with an active roster peer, and settle the peer's discovery; measured after provisioning and roster import | 66 | 130,000 request and 530,000 response bytes; 18 syncs (1-2 write-bearing, at most 16 read-only); 9 document projections; 11 parent-lane queries; 4 listings; 23 organization-policy reads; 4 recitations; 1 share |
| [`packages/app/src/mini-apps/explorer/ExplorerUploadRequestVolume.test.tsx`](../packages/app/src/mini-apps/explorer/ExplorerUploadRequestVolume.test.tsx) | Upload one small image from Explorer | 9 | One document create, one multipart stage, one part upload, one attachment binding, three syncs; no per-part authorization or stage-completion request |
| `DualPaneProvider.activePeerRequestVolume.test.tsx` | An active peer reconciles an ungranted custom-group change | Exactly 4 | One read-model read, two organization-policy reads and one group-policy read; no container or document request and no Admins-policy read |
| `DeviceFirstOfflineRequestVolume.test.tsx` | Offline folder create, cached note edit, and move to Trash | 0 each | After reconnect the queued create, link and unlink commit |

`DualPaneProvider.sidebarReloadBudget.test.tsx` budgets local sidebar reload
passes during cold bootstrap, not HTTP requests.

Most policy reads in these budgets come from private metadata-root authority:
each workflow operation reads the server-current organization policy once, and
a head new to the device needs its first read. See
[current-policy request costs](developer/current-principal-consumers.md#request-costs)
and [principal-history acceptance](principal-history-acceptance.md) for that
security tradeoff.

## Design decisions

These choices keep request counts above the minimum on purpose.

### Authoritative reconciliation

Realtime events are volatile hints. Interest routes them to the right lanes but
grants no access, and a hint can be lost. Recovery therefore comes from
authoritative reconciliation ([`packages/client-sdk/src/sync/reconciliation/`](../packages/client-sdk/src/sync/reconciliation/)),
not from replaying a durable delta log, which would need its own replay
authorization, atomic event durability, retention, acknowledgements and
ordered local application.

- Initial hydration discovers authorized parent and document lanes. The initial
  missing-document probe reuses a completed unwatermarked discovery listing
  only after every page and its local persistence succeed, for the same probe
  generation and container; incremental, partial or earlier-lifecycle listings
  cannot substitute for it.
- Scoped hints force the affected lanes, including the parent lane needed to
  remove a nested revoked or deleted child. Newer force generations survive
  older completions, and temporary failures keep the force with bounded
  automatic retries.
- A reconnect drops cached writer projections, installs and acknowledges the
  current interest set, and then runs reconciliation
  ([`packages/app/src/providers/sdk/serverEventsBinding.ts`](../packages/app/src/providers/sdk/serverEventsBinding.ts)).
  Distinct login sessions of the same identity receive each other's events, so
  session origin alone cannot suppress a sibling client's read-model refresh.
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
`POST /containers/documents/query` lists up to 32 container lanes
(`MAX_CONTAINER_DOCUMENT_LANES`) per request, each through the singular listing
with its own readable-container gate, access resolver, watermark and page
bound. The lanes share one request-scoped cache of verified principal policies
by reference, and a lane's linked containers reuse the policies its gate
loaded, so batching also saves statements; every container path is still
verified.

### Separate projection reads

Container and document writer projections stay separate, independently
verified reads rather than being inlined into listings. Listing rows and access
resolution do not share a transaction snapshot, and inlining would need new
snapshot, response-size, verification and cache-race rules and would duplicate
signed paths. Projection reads instead cite manifest bundles the device already
holds; see [the incremental evidence
contract](projection-policy-evidence.md#cost-and-retained-history-tradeoff).

### Current policy before signed mutations

Group creation and membership changes spend most of their requests reading
policy heads and refreshing the organization read model. Those reads feed
signed compare-and-swap mutations, so reusing stale authorization state to save
them is not an option. Unlinking a document reads a current writer projection
and runs a rotation-preflight sync; dropping either would need another proof
that the client holds current authorization and complete history. Moving a
document to Trash is a durable link-then-unlink workflow: an outage can briefly
leave both links present, and a retry completes the remaining leg.
