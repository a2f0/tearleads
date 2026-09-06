# Request-budget closeout

This audit closes [#1512](https://github.com/a2f0/tearleads/issues/1512) and
tracks the remaining work in [#2203](https://github.com/a2f0/tearleads/issues/2203).
It inspected `main` at `e06f90232` and the implementation below. This is a
pre-deployment, greenfield system; retained endpoints are the chosen protocol,
not compatibility fallbacks.

## Shipped progress and dispositions

| Work | Evidence and disposition |
| --- | --- |
| Original safe reductions | [#1332](https://github.com/a2f0/tearleads/pull/1332) corrected test routing, suppressed self-echo/idempotent rebroadcast and retained verification. [#1492](https://github.com/a2f0/tearleads/pull/1492) added structural invalidation and missed-hint recovery. |
| Parent discovery and policy reuse | [#1612](https://github.com/a2f0/tearleads/pull/1612) replaced singular container listing with bounded parent-lane batches and removed `GET /containers`. Exactly referenced policy bundles are reused only after independent verification; current mutation heads remain remote. |
| Workflow budgets and bootstrap | [#2191](https://github.com/a2f0/tearleads/pull/2191) reduced personal bootstrap 30 → 25 by reusing completed full listings, added operation budgets, and repaired moves stranded by valid historical key rewrapping. [#2202](https://github.com/a2f0/tearleads/pull/2202) hardened local/offline progress and recovery. See [workflow measurements](workflow-request-audit.md) and [Device First audit](device-first-audit.md). |
| A0: fallback correctness | Generation-aware forced reconciliation, failed/in-flight discovery, nested parent-lane cleanup, and initial recovery are implemented and tested. This closeout adds the explicit temporary-404 regression and fixes fractional timestamp pagination. |
| A1–A3: durable deltas and poll removal | **Will not fix in this initiative.** Replay authorization, atomic event durability, retention, acknowledgements and ordered local application constitute a separate distributed protocol. Existing volatile hints do not justify removing authoritative reconciliation. |
| B: batched document probes | **Will not fix.** Ordinary unopened documents are already lazy. Pull-only eligibility is measured, but HTTP count alone does not establish less database/crypto work. Keep bounded singular sync, independent authorization, structural ordering and 409/retry behavior. |
| C: inline writer projections | **Will not fix.** List rows and access resolution currently do not share a transaction snapshot. Inlining would require new snapshot, response-size, verification and cache-race rules and duplicate signed paths. Existing independently verified projection reads remain; byte profiles show why this is not automatically a bandwidth win. |
| Rollout shims and old percentage targets | **Will not fix.** No legacy clients or production rollout need supporting. The old 104-request profile and A/B/C percentage goals are superseded by current operation budgets. |

These dispositions retire proposed implementations, not authorization,
revocation, anti-rollback/equivocation, local-intent or convergence constraints.
References in old issue checklists to delta replay and shadow validation do not
describe shipped features.

## Recovery reads that remain

The current behavior is implemented in
[reconciliation](../packages/client-sdk/src/sync/reconciliation/service.ts),
[document pull policy](../packages/client-sdk/src/sync/reconciliation/documentContentPull.ts),
[connection backoff](../packages/app/src/providers/sdk/serverEventsConnectionLoop.ts)
and [event binding](../packages/app/src/providers/sdk/serverEventsBinding.ts).

- Initial hydration discovers authorized parent/document lanes. Missing-document
  recovery uses a complete unwatermarked listing; partial, incremental and
  obsolete-generation listings cannot substitute for it.
- Scoped hints force affected lanes, including the parent lane needed to remove
  a nested revoked/deleted child. Repeated ordinary root hints skip settled lanes;
  newer force generations survive older completions. Temporary failures retain
  force, with bounded automatic retries for rejected discovery.
- A reconnect installs and acknowledges the current interest set before advancing
  the connection generation, clears projection caches and runs authoritative
  reconciliation. Interest routes hints; it grants no access. Distinct login
  sessions of the same identity receive each other's events. Session attribution
  cannot safely eliminate a same-session sibling client's read-model refresh.
- Explicit Refresh/Sync remains a recovery signal. Ordinary opened documents probe
  on startup, acknowledged reconnect or forced invalidation; unopened ordinary
  content stays lazy, while system projections are eager.

There is **no universal periodic full-tree HTTP sweep** on a continuously healthy
socket. A silently lost hint can wait for another relevant signal, reconnect,
startup or explicit refresh. Existing missed-hint tests prove those recovery
paths, not a bounded periodic recovery SLA or durable delivery. Adding an idle
polling workload solely to satisfy the obsolete design would increase requests.
Server authorization and cryptographic checks remain authoritative during this
interval; a cached UI is not proof of continuing remote write access.

## Discovery correctness and server work

The previous pagination fixtures inserted JavaScript Dates, which erased the
PostgreSQL microseconds before the test began. SQL ordered native timestamps but
response merging and subsequent cursors used milliseconds. Mixed live/tombstone
pages could select the wrong next change and repeatedly serve a row whose native
timestamp remained greater than its truncated cursor.

The fixtures now insert fractional PostgreSQL timestamps through SQL, with time
order deliberately differing from ID order, and exercise all page sizes. Response
merging, cursor normalization and SQL predicates retain microseconds. SQLite keeps
integer milliseconds and exercises ID ties with the same fixture. SQL WHERE and
ORDER BY keep the timestamp columns unmodified; formatting occurs in SELECT, so
this fix does not replace indexed timestamp comparison with a truncation function.
Microseconds stay in internal page ordering and the opaque `nextWatermark`.
Clients persist and return that cursor; they must not reconstruct it from an item.
Returned item/tombstone timestamps use the same millisecond representation as
mutation and read-model responses. Exposing extra precision only through discovery
would make the same row appear newer than a later mutation acknowledgement.
Keeping one entity timestamp contract avoids that false stale-result failure and
requires no SDK persistence, comparison or public-export changes. Cursor precision
is a pagination concern, not a new entity freshness or authorization token.
This establishes exhaustion of a static discovery stream, not a durable log of
concurrent writes or access changes; forced full reconciliation still matters.

Document listing also selects its mixed live/tombstone page **before** loading
linked-container paths. Previously it expanded every live candidate, including
lookahead rows and rows displaced by tombstones. A tombstone-only page with a live
lookahead now performs zero document-link expansion queries, verified through the
real route. Selected documents retain the same readable-container gate and access
resolver. No new route, database index, dependency or cryptographic shortcut is
introduced.

## Measurement method

Ten independent processes per scenario use the real application, SDK and test API
on the in-memory PostgreSQL-compatible adapter. The recorder reports completed
proxied HTTP calls, exact uncompressed request/response **body bytes**, and parsed
`outgoingUpdates` intent for document sync. Binary bodies are counted before text
decoding and returned unchanged. Missing or malformed sync bodies cannot silently
count as probes. Headers, WebSocket traffic, TLS, compression, real network latency
and database CPU are outside this measurement.

The owner-root scenario starts **after provisioning and roster import** and ends
after automatic shared-note discovery and settlement. Its phase markers follow
existing UI helper completion, so a local-first write can complete in the next
phase. Only the whole settled scenario is a request budget. Admin navigation and
mutation are isolated after provisioning settles. These boundaries differ from
older issue snapshots; the new totals must not be advertised as a percentage
improvement caused by this PR.

Reproduce each scenario ten times from `packages/app`, after
`bun run --filter='@tearleads/client-sdk' build` at the repository root:

```sh
DUAL_PANE_REQUEST_PROFILE=1 DUAL_PANE_REQUEST_PROFILE_DETAIL=1 \
  bun test src/components/pane/tests/DualPaneProvider.sharing.test.tsx \
  --test-name-pattern 'root grant after attachment writes'
DUAL_PANE_REQUEST_PROFILE=1 DUAL_PANE_REQUEST_PROFILE_DETAIL=1 \
  bun test src/components/pane/tests/DualPaneProvider.groupsRequestVolume.test.tsx
```

Each `[dual-pane-request-metrics]` JSON line contains the phase, total, body bytes,
sync intents and normalized endpoint counts/bytes. The detailed text profile also
identifies repeated exact paths. Tables below use **min / median / max**; zeroes
include runs in which an endpoint was absent. Fractional medians are retained.
Byte variation includes generated IDs, signatures, ciphertext and timing-dependent
projection paths.

## Ten-run phases (2026-09-06, cursor-only implementation)

| Scenario / phase | Requests | Request bytes | Response bytes | Pull-only syncs | Write-bearing syncs |
| --- | ---: | ---: | ---: | ---: | ---: |
| root / open left explorer | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| root / open right explorer | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| root / create empty folder | 1 / 1 / 1 | 0 / 0 / 0 | 13,594 / 13,594 / 13,594 | 0 / 0 / 0 | 0 / 0 / 0 |
| root / create note with attachment | 9 / 9 / 9 | 75,731 / 75,731 / 75,731 | 53,681 / 53,681 / 53,681 | 0 / 0 / 0 | 1 / 1 / 1 |
| root / share root + post-share settle | 49 / 54 / 54 | 265,917 / 266,791 / 266,791 | 696,561 / 929,143 / 929,143 | 11 / 14 / 14 | 1 / 1 / 1 |
| root / auto-discover shared note settle | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| root / test total | 59 / 64 / 64 | 341,648 / 342,522 / 342,522 | 763,836 / 996,418 / 996,418 | 11 / 14 / 14 | 2 / 2 / 2 |
| admin / provisioning + settle | 50 / 50 / 50 | 819,861 / 819,953 / 820,154 | 430,268 / 430,268 / 430,268 | 10 / 10 / 10 | 6 / 6 / 6 |
| admin / open org manager + select Admins | 1 / 1 / 1 | 0 / 0 / 0 | 20,659 / 20,659 / 20,659 | 0 / 0 / 0 | 0 / 0 / 0 |
| admin / admin-group add + settle | 57 / 57 / 57 | 318,247 / 318,247 / 318,247 | 1,516,066 / 1,516,066 / 1,516,066 | 11 / 11 / 11 | 0 / 0 / 0 |
| admin / admin-group mutation + settle | 56 / 56 / 56 | 318,247 / 318,247 / 318,247 | 1,495,407 / 1,495,407 / 1,495,407 | 11 / 11 / 11 | 0 / 0 / 0 |

## Root endpoints: test total

| Endpoint | Requests | Request bytes | Response bytes |
| --- | ---: | ---: | ---: |
| `GET /blobs/:blobId/bytes` | 1 / 1 / 1 | 0 / 0 / 0 | 529 / 529 / 529 |
| `GET /containers/:containerId/documents` | 8 / 8 / 9 | 0 / 0 / 0 | 2,789 / 2,789 / 2,934 |
| `GET /containers/:containerId/writer-projection` | 2 / 2 / 2 | 0 / 0 / 0 | 39,577 / 39,577 / 39,577 |
| `GET /documents/:documentId/attachments` | 2 / 2 / 2 | 0 / 0 / 0 | 35,614 / 35,614 / 35,614 |
| `GET /documents/:documentId/writer-projection` | 5 / 8 / 8 | 0 / 0 / 0 | 435,893 / 664,873 / 664,873 |
| `GET /organizations/:organizationId/read-model` | 6 / 6 / 6 | 0 / 0 / 0 | 12,125 / 12,125 / 12,125 |
| `POST /blobs/:blobId/attachment-bindings` | 1 / 1 / 1 | 15,441 / 15,441 / 15,441 | 17,942 / 17,942 / 17,942 |
| `POST /blobs/stages/multipart` | 1 / 1 / 1 | 150 / 150 / 150 | 307 / 307 / 307 |
| `POST /blobs/stages/multipart/:stageId/complete` | 1 / 1 / 1 | 152 / 152 / 152 | 238 / 238 / 238 |
| `POST /containers/:containerId/recite` | 4 / 4 / 4 | 190,412 / 190,412 / 190,412 | 37,323 / 37,323 / 37,323 |
| `POST /containers/:containerId/share` | 1 / 1 / 1 | 52,680 / 52,680 / 52,680 | 26,487 / 26,487 / 26,487 |
| `POST /containers/parent-lanes/query` | 10 / 10 / 10 | 1,983 / 1,983 / 2,063 | 56,832 / 57,913 / 57,913 |
| `POST /containers/with-metadata-document` | 1 / 1 / 1 | 41,525 / 41,525 / 41,525 | 21,098 / 21,098 / 21,098 |
| `POST /documents` | 1 / 1 / 1 | 8,615 / 8,615 / 8,615 | 9,761 / 9,761 / 9,761 |
| `POST /documents/:documentId/sync` | 13 / 16 / 16 | 30,081 / 31,035 / 31,035 | 66,961 / 69,627 / 69,627 |
| `PUT /blobs/stages/multipart/:stageId/parts/:partNumber/bytes` | 1 / 1 / 1 | 529 / 529 / 529 | 215 / 215 / 215 |

## Root endpoints: share root + post-share settle

| Endpoint | Requests | Request bytes | Response bytes |
| --- | ---: | ---: | ---: |
| `GET /blobs/:blobId/bytes` | 1 / 1 / 1 | 0 / 0 / 0 | 529 / 529 / 529 |
| `GET /containers/:containerId/documents` | 7 / 7 / 8 | 0 / 0 / 0 | 2,724 / 2,724 / 2,869 |
| `GET /containers/:containerId/writer-projection` | 1 / 1 / 1 | 0 / 0 / 0 | 25,983 / 25,983 / 25,983 |
| `GET /documents/:documentId/attachments` | 2 / 2 / 2 | 0 / 0 / 0 | 35,614 / 35,614 / 35,614 |
| `GET /documents/:documentId/writer-projection` | 5 / 8 / 8 | 0 / 0 / 0 | 435,893 / 664,873 / 664,873 |
| `GET /organizations/:organizationId/read-model` | 5 / 5 / 5 | 0 / 0 / 0 | 10,620 / 10,620 / 10,620 |
| `POST /containers/:containerId/recite` | 4 / 4 / 4 | 190,412 / 190,412 / 190,412 | 37,323 / 37,323 / 37,323 |
| `POST /containers/:containerId/share` | 1 / 1 / 1 | 52,680 / 52,680 / 52,680 | 26,487 / 26,487 / 26,487 |
| `POST /containers/parent-lanes/query` | 10 / 10 / 10 | 1,983 / 1,983 / 2,063 | 56,832 / 57,913 / 57,913 |
| `POST /documents/:documentId/sync` | 12 / 15 / 15 | 20,762 / 21,716 / 21,716 | 64,411 / 67,077 / 67,077 |

## Admin endpoints: admin-group mutation + settle

| Endpoint | Requests | Request bytes | Response bytes |
| --- | ---: | ---: | ---: |
| `GET /auth/user-identity/:userId` | 2 / 2 / 2 | 0 / 0 / 0 | 11,670 / 11,670 / 11,670 |
| `GET /containers/:containerId/documents` | 5 / 5 / 5 | 0 / 0 / 0 | 2,157 / 2,157 / 2,157 |
| `GET /containers/:containerId/writer-projection` | 2 / 2 / 2 | 0 / 0 / 0 | 51,412 / 51,412 / 51,412 |
| `GET /documents/:documentId/writer-projection` | 8 / 8 / 8 | 0 / 0 / 0 | 839,801 / 839,801 / 839,801 |
| `GET /organizations/:organizationId/billing` | 1 / 1 / 1 | 0 / 0 / 0 | 463 / 463 / 463 |
| `GET /organizations/:organizationId/groups/:groupId/members` | 1 / 1 / 1 | 0 / 0 / 0 | 5,969 / 5,969 / 5,969 |
| `GET /organizations/:organizationId/read-model` | 5 / 5 / 5 | 0 / 0 / 0 | 42,374 / 42,374 / 42,374 |
| `GET /principals/group/:groupId/policy` | 8 / 8 / 8 | 0 / 0 / 0 | 198,893 / 198,893 / 198,893 |
| `GET /principals/organization/:organizationId/policy` | 2 / 2 / 2 | 0 / 0 / 0 | 44,567 / 44,567 / 44,567 |
| `POST /containers/:containerId/recite` | 2 / 2 / 2 | 101,948 / 101,948 / 101,948 | 19,141 / 19,141 / 19,141 |
| `POST /containers/parent-lanes/query` | 7 / 7 / 7 | 1,290 / 1,290 / 1,290 | 34,456 / 34,456 / 34,456 |
| `POST /documents/:documentId/sync` | 11 / 11 / 11 | 3,345 / 3,345 / 3,345 | 59,342 / 59,342 / 59,342 |
| `PUT /organizations/:organizationId/groups/:groupId/policy-commit` | 2 / 2 / 2 | 211,664 / 211,664 / 211,664 | 185,162 / 185,162 / 185,162 |

## Budgets and validation coverage

The owner-root total ceiling is now **67**, down from the stale **105**, with
18 sync POSTs, 10 document-list GETs, nine document writer-projection GETs and
11 parent-lane queries at most. It pins two write-bearing syncs and allows at most
16 pull-only syncs. Body ceilings are 380,000 request bytes and 1,100,000 response
bytes. This locks in current behavior; the change itself does not claim to have
removed 38 requests.

The Admin mutation keeps its **58** total ceiling. Endpoint ceilings are tightened
to eight parent-lane queries, six document listings, nine group-policy reads and
nine document-projection reads. It retains zero write-bearing document syncs and
at most 12 pull-only syncs. Body ceilings are 350,000 request bytes and 1,650,000
response bytes. Authoritative policy reads, root re-citation and same-session
sibling feed refreshes remain.

Coverage includes PostgreSQL-compatible/SQLite discovery property tests, the
real-route zero-expansion assertion, binary/UTF-8 measurement tests, explicit
404 recovery, in-flight force generations, nested parent-lane tombstones,
checkpoint enforcement, reconnect/interest acknowledgement, independent-session
mutations and deliberately dropped hints. Healthy fixture byte/request ceilings
are separate from failure convergence and retry tests; they are not outage caps
or guarantees for arbitrarily large organizations or attachments.
