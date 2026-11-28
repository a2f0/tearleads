# Performance Epoch 2: Greenfield Protocol, Database & Realtime Optimization Pass

Structured longitudinal performance snapshots capturing schema, wire, API DB,
client SQLite, query plan, multi-party scenario, and scaling probe metrics
across greenfield optimization PRs. Started 2026-11-27T22:34:02.103Z.

## Checkpoints

| Checkpoint | Kind | Revision | PR | Issues | Label | Step Summary |
| --- | --- | --- | --- | --- | --- | --- |
| `000-baseline` | baseline | `53819b364` | — | #3263, #3289, #3291, #3342, #3353, #3396 | Main baseline (53819b364) | Epoch baseline |
| `001-server-counts-parent-lanes` | checkpoint | `d7e01be58` | — | #3342 | Server update counts & parent-lane batch (#3342) | 12 improved, 2 regressed, 8 tradeoffs |
| `002-realtime-subtree-interest` | checkpoint | `0aa3ec975` | — | #3353 | Subtree-root realtime interest & hub caps (#3353) | 10 improved, 0 regressed, 0 tradeoffs |
| `003-loro-stale-recreation-rebase` | checkpoint | `d74895157` | — | #3263 | Preserved peer ownership, owner allow-restore, pull-only park, multi-segment recovery, causal closure (#3263) | 0 improved, 7 regressed, 0 tradeoffs |
| `004-api-repeats-plans` | checkpoint | `da79619ff` | — | #3396 | PR #7 (#3396 Leads 1 & 4): API tx memo and PG plans | 7 improved, 2 regressed, 3 tradeoffs |
| `005-wire-compactness` | checkpoint | `45ce6bb0a` | — | #3396 | PR #8 (#3396 Lead 2): wire compactness, authored KEK citations, held history & read-path policy warmers | 10 improved, 0 regressed, 0 tradeoffs |

## Cumulative Scorecard (`000-baseline` -> `005-wire-compactness`)

| Dimension | Metric | Baseline | Latest | Delta | Verdict |
| --- | --- | ---: | ---: | ---: | --- |
| Schema | API Postgres tables | 57 tables | — | — | n/a |
| Schema | API Postgres indexes | 183 indexes | — | — | n/a |
| Schema | API duplicate indexes | 0 indexes | — | — | n/a |
| Schema | Client SQLite tables | 63 tables | — | — | n/a |
| Schema | Unread 2xx OpenAPI fields | 3 fields | — | — | n/a |
| Schema | Drifted canary ceilings | 14 phases | — | — | n/a |
| Wire | Canary requests | 340 reqs | 260 reqs | -80 (-23.5%) | improved |
| Wire | Canary request bytes | 1,609,389 B | 1,607,684 B | -1,705 (-0.1%) | unchanged |
| Wire | Canary response bytes | 1,492,860 B | 1,260,907 B | -231,953 (-15.5%) | improved |
| Wire | Canary redundant response bytes | 198,160 B | 110,912 B | -87,248 (-44%) | improved |
| Wire | Exact-head policy re-reads | 42 reads | 18 reads | -24 (-57.1%) | improved |
| API DB | Canary API SQL statements | 36,878 stmts | 31,446 stmts | -5,432 (-14.7%) | improved |
| API DB | Canary API in-tx statements | 30,788 stmts | 26,432 stmts | -4,356 (-14.1%) | improved |
| API DB | Canary API lock-hold statements | 22,227 stmts | 18,641 stmts | -3,586 (-16.1%) | improved |
| API DB | Canary API pure read repeats | 4,744 repeats | 1,675 repeats | -3,069 (-64.7%) | improved |
| Client SQLite | Canary client SQLite statements | 131,525 stmts | 123,422 stmts | -8,103 (-6.2%) | improved |
| Client SQLite | Canary SQLite tx controls | 32,446 stmts | 30,226 stmts | -2,220 (-6.8%) | improved |
| Client SQLite | Canary SQLite total duration | 13,058.2 ms | 12,500.6 ms | -557.6 (-4.3%) | unchanged |
| Client SQLite | Canary SQLite max lock hold | 49.4 ms | 76.9 ms | +27.5 (+55.7%) | REGRESSED |
| Plans | Postgres generic Seq Scans | 0 queries | — | — | n/a |
| Plans | Postgres generic Sort plans | 3 queries | — | — | n/a |
| Plans | Postgres generic Materialize plans | 1 queries | — | — | n/a |
| Scenarios | Bob-and-Alice HTTP requests | 4,975 reqs | — | — | n/a |
| Scenarios | Bob-and-Alice API statements | 122,420 stmts | — | — | n/a |
| Scenarios | Bob-and-Alice pure read repeats | 14,321 repeats | — | — | n/a |
| Scenarios | Bob-and-Alice client SQLite | 486,496 stmts | — | — | n/a |
| Reload | Settled reload requests (shared max tier) | 4 reqs | — | — | n/a |
| Reload | Settled reload API statements | 62 stmts | — | — | n/a |
| Reload | Settled reload client SQLite | 481 stmts | — | — | n/a |
| Realtime | Realtime hub auth statements | 9 stmts | — | — | n/a |
| Realtime | Realtime hub auth PG bytes | 1,383,651 B | — | — | n/a |
| Rotations | Rotation group-shrink PG statements | 623 stmts | — | — | n/a |
| Baselines | Baseline first-unlink PG statements | 102 stmts | — | — | n/a |

## Step-by-Step Deltas & Tradeoffs

### `000-baseline` -> `001-server-counts-parent-lanes`

Server update counts & parent-lane batch (#3342). Revisions: `53819b364` ->
`d7e01be58`. Improved: **12**, Regressed: **2**, Tradeoffs: **8**.

Notes: Trigger-maintained documents.update_count +
attribution_revision/updated_at; roster-profile container suppression;
verified idsOnly root-membership parent-lane batch inside repeatable-read
snapshot.

| Dimension | Metric | Before | After | Delta | Verdict |
| --- | --- | ---: | ---: | ---: | --- |
| Schema | Drifted canary ceilings | 14 phases | 19 phases | +5 (+35.7%) | REGRESSED |
| Wire | Canary requests | 340 reqs | 314 reqs | -26 (-7.6%) | improved |
| Wire | Canary response bytes | 1,492,860 B | 1,414,538 B | -78,322 (-5.2%) | improved |
| Wire | Canary redundant response bytes | 198,160 B | 190,224 B | -7,936 (-4%) | improved |
| Wire | Exact-head policy re-reads | 42 reads | 39 reads | -3 (-7.1%) | improved |
| API DB | Canary API SQL statements | 36,878 stmts | 36,268 stmts | -610 (-1.7%) | improved |
| API DB | Canary API in-tx statements | 30,788 stmts | 31,281 stmts | +493 (+1.6%) | REGRESSED |
| API DB | Canary API lock-hold statements | 22,227 stmts | 21,998 stmts | -229 (-1%) | improved |
| API DB | Canary API pure read repeats | 4,744 repeats | 4,704 repeats | -40 (-0.8%) | improved |
| Client SQLite | Canary client SQLite statements | 131,525 stmts | 125,471 stmts | -6,054 (-4.6%) | improved |
| Client SQLite | Canary SQLite tx controls | 32,446 stmts | 30,664 stmts | -1,782 (-5.5%) | improved |
| Reload | Settled reload requests (shared max tier) | 4 reqs | 1 reqs | -3 (-75%) | improved |
| Reload | Settled reload API statements | 62 stmts | 26 stmts | -36 (-58.1%) | improved |
| Reload | Settled reload client SQLite | 481 stmts | 145 stmts | -336 (-69.9%) | improved |

**Tradeoffs:**

- **Wire** (Canary requests: -26 reqs (-7.6%); Canary response bytes: -78322 B
  (-5.2%); Canary redundant response bytes: -7936 B (-4%)) vs **Schema**
  (Drifted canary ceilings: +5 phases (+35.7%))
- **Wire** (Canary requests: -26 reqs (-7.6%); Canary response bytes: -78322 B
  (-5.2%); Canary redundant response bytes: -7936 B (-4%)) vs **API DB**
  (Canary API in-tx statements: +493 stmts (+1.6%))
- **API DB** (Canary API SQL statements: -610 stmts (-1.7%); Canary API
  lock-hold statements: -229 stmts (-1%); Canary API pure read repeats: -40
  repeats (-0.8%)) vs **Schema** (Drifted canary ceilings: +5 phases (+35.7%))
- **API DB** (Canary API SQL statements: -610 stmts (-1.7%); Canary API
  lock-hold statements: -229 stmts (-1%); Canary API pure read repeats: -40
  repeats (-0.8%)) vs **API DB** (Canary API in-tx statements: +493 stmts
  (+1.6%))
- **Client SQLite** (Canary client SQLite statements: -6054 stmts (-4.6%);
  Canary SQLite tx controls: -1782 stmts (-5.5%)) vs **Schema** (Drifted
  canary ceilings: +5 phases (+35.7%))
- **Client SQLite** (Canary client SQLite statements: -6054 stmts (-4.6%);
  Canary SQLite tx controls: -1782 stmts (-5.5%)) vs **API DB** (Canary API
  in-tx statements: +493 stmts (+1.6%))
- **Reload** (Settled reload requests (shared max tier): -3 reqs (-75%);
  Settled reload API statements: -36 stmts (-58.1%); Settled reload client
  SQLite: -336 stmts (-69.9%)) vs **Schema** (Drifted canary ceilings: +5
  phases (+35.7%))
- **Reload** (Settled reload requests (shared max tier): -3 reqs (-75%);
  Settled reload API statements: -36 stmts (-58.1%); Settled reload client
  SQLite: -336 stmts (-69.9%)) vs **API DB** (Canary API in-tx statements:
  +493 stmts (+1.6%))

### `001-server-counts-parent-lanes` -> `002-realtime-subtree-interest`

Subtree-root realtime interest & hub caps (#3353). Revisions: `d7e01be58` ->
`0aa3ec975`. Improved: **10**, Regressed: **0**, Tradeoffs: **0**.

Notes: Declares only subtree roots (top-level roots + directly granted nested
folders persisted via root_lane_member v18 migration) with hub
subtree-coverage routing, 256-root declaration/installed cap, 512 pending id
cap, flat 10s deadline, repeatable-read 1,024 path-container depth budget
scoped via discoveryGrantSubjects/containerHasDiscoveryAccess, and marker
write-back. 100x1000-folder simultaneous reconnect contention: 318-323ms
total, p99 hint lag 1.7-2.6ms, 18-21 MiB peak heap.

| Dimension | Metric | Before | After | Delta | Verdict |
| --- | --- | ---: | ---: | ---: | --- |
| Wire | Canary requests | 314 reqs | 306 reqs | -8 (-2.5%) | improved |
| Wire | Canary response bytes | 1,414,538 B | 1,398,775 B | -15,763 (-1.1%) | improved |
| Wire | Canary redundant response bytes | 190,224 B | 188,401 B | -1,823 (-1%) | improved |
| Wire | Exact-head policy re-reads | 39 reads | 37 reads | -2 (-5.1%) | improved |
| API DB | Canary API SQL statements | 36,268 stmts | 36,065 stmts | -203 (-0.6%) | improved |
| API DB | Canary API in-tx statements | 31,281 stmts | 31,134 stmts | -147 (-0.5%) | improved |
| API DB | Canary API lock-hold statements | 21,998 stmts | 21,966 stmts | -32 (-0.1%) | improved |
| API DB | Canary API pure read repeats | 4,704 repeats | 4,694 repeats | -10 (-0.2%) | improved |
| Client SQLite | Canary client SQLite statements | 125,471 stmts | 124,712 stmts | -759 (-0.6%) | improved |
| Client SQLite | Canary SQLite tx controls | 30,664 stmts | 30,516 stmts | -148 (-0.5%) | improved |

### `002-realtime-subtree-interest` -> `003-loro-stale-recreation-rebase`

Preserved peer ownership, owner allow-restore, pull-only park, multi-segment
recovery, causal closure (#3263). Revisions: `0aa3ec975` -> `d74895157`.
Improved: **0**, Regressed: **7**, Tradeoffs: **0**.

Notes: Adds purged_document_peer_owners table (58th Postgres table, +2
indexes) via append-only migration 0018 (+7 bootstrap DDL statements per fresh
PGlite canary; 0 extra hot-path runtime queries or plan regressions).

| Dimension | Metric | Before | After | Delta | Verdict |
| --- | --- | ---: | ---: | ---: | --- |
| Schema | API Postgres tables | 57 tables | 58 tables | +1 (+1.8%) | changed |
| Schema | API Postgres indexes | 183 indexes | 185 indexes | +2 (+1.1%) | changed |
| API DB | Canary API SQL statements | 36,065 stmts | 36,264 stmts | +199 (+0.6%) | REGRESSED |
| API DB | Canary API in-tx statements | 31,134 stmts | 31,232 stmts | +98 (+0.3%) | REGRESSED |
| API DB | Canary API lock-hold statements | 21,966 stmts | 21,998 stmts | +32 (+0.1%) | REGRESSED |
| API DB | Canary API pure read repeats | 4,694 repeats | 4,705 repeats | +11 (+0.2%) | REGRESSED |
| Client SQLite | Canary client SQLite statements | 124,712 stmts | 125,246 stmts | +534 (+0.4%) | REGRESSED |
| Client SQLite | Canary SQLite tx controls | 30,516 stmts | 30,614 stmts | +98 (+0.3%) | REGRESSED |
| Client SQLite | Canary SQLite max lock hold | 45 ms | 197.8 ms | +152.8 (+339.6%) | REGRESSED |

### `003-loro-stale-recreation-rebase` -> `004-api-repeats-plans`

PR #7 (#3396 Leads 1 & 4): API tx memo and PG plans. Revisions: `d74895157` ->
`da79619ff`. Improved: **7**, Regressed: **2**, Tradeoffs: **3**.

Notes: Eliminated API pure read repeats inside transactions/lock holds
(principal policy evidence reuse, container manifest/org memoization,
prelocked provisioning scope, verified pre-lock sync access reuse under held
frontier locks) and eliminated Postgres generic-plan Sort/Materialize.

| Dimension | Metric | Before | After | Delta | Verdict |
| --- | --- | ---: | ---: | ---: | --- |
| API DB | Canary API SQL statements | 36,264 stmts | 32,934 stmts | -3,330 (-9.2%) | improved |
| API DB | Canary API in-tx statements | 31,232 stmts | 27,909 stmts | -3,323 (-10.6%) | improved |
| API DB | Canary API lock-hold statements | 21,998 stmts | 18,671 stmts | -3,327 (-15.1%) | improved |
| API DB | Canary API pure read repeats | 4,705 repeats | 1,681 repeats | -3,024 (-64.3%) | improved |
| Client SQLite | Canary client SQLite statements | 125,246 stmts | 125,318 stmts | +72 (+0.1%) | REGRESSED |
| Client SQLite | Canary SQLite tx controls | 30,614 stmts | 30,656 stmts | +42 (+0.1%) | REGRESSED |
| Client SQLite | Canary SQLite max lock hold | 197.8 ms | 76.5 ms | -121.3 (-61.3%) | improved |
| Plans | Postgres generic Sort plans | 3 queries | 1 queries | -2 (-66.7%) | improved |
| Plans | Postgres generic Materialize plans | 1 queries | 0 queries | -1 (-100%) | improved |

**Tradeoffs:**

- **API DB** (Canary API SQL statements: -3330 stmts (-9.2%); Canary API in-tx
  statements: -3323 stmts (-10.6%); Canary API lock-hold statements: -3327
  stmts (-15.1%)) vs **Client SQLite** (Canary client SQLite statements: +72
  stmts (+0.1%); Canary SQLite tx controls: +42 stmts (+0.1%))
- **Client SQLite** (Canary SQLite max lock hold: -121.3 ms (-61.3%)) vs
  **Client SQLite** (Canary client SQLite statements: +72 stmts (+0.1%);
  Canary SQLite tx controls: +42 stmts (+0.1%))
- **Plans** (Postgres generic Sort plans: -2 queries (-66.7%); Postgres
  generic Materialize plans: -1 queries (-100%)) vs **Client SQLite** (Canary
  client SQLite statements: +72 stmts (+0.1%); Canary SQLite tx controls: +42
  stmts (+0.1%))

### `004-api-repeats-plans` -> `005-wire-compactness`

PR #8 (#3396 Lead 2): wire compactness, authored KEK citations, held history &
read-path policy warmers. Revisions: `da79619ff` -> `45ce6bb0a`. Improved:
**10**, Regressed: **0**, Tradeoffs: **0**.

Notes: Normalizes containerManifestHistory out of KEK level citation digests,
caches authored container KEK levels on mutation acknowledgement, verifies
locally held principal policy chains before GET /principals/history, and
enables preferLocalCurrent on read/verification/read-only-pull policy warmers
(keeping write-planning warmers fresh).

| Dimension | Metric | Before | After | Delta | Verdict |
| --- | --- | ---: | ---: | ---: | --- |
| Wire | Canary requests | 306 reqs | 260 reqs | -46 (-15%) | improved |
| Wire | Canary response bytes | 1,398,775 B | 1,260,907 B | -137,868 (-9.9%) | improved |
| Wire | Canary redundant response bytes | 188,401 B | 110,912 B | -77,489 (-41.1%) | improved |
| Wire | Exact-head policy re-reads | 37 reads | 18 reads | -19 (-51.4%) | improved |
| API DB | Canary API SQL statements | 32,934 stmts | 31,446 stmts | -1,488 (-4.5%) | improved |
| API DB | Canary API in-tx statements | 27,909 stmts | 26,432 stmts | -1,477 (-5.3%) | improved |
| API DB | Canary API lock-hold statements | 18,671 stmts | 18,641 stmts | -30 (-0.2%) | improved |
| API DB | Canary API pure read repeats | 1,681 repeats | 1,675 repeats | -6 (-0.4%) | improved |
| Client SQLite | Canary client SQLite statements | 125,318 stmts | 123,422 stmts | -1,896 (-1.5%) | improved |
| Client SQLite | Canary SQLite tx controls | 30,656 stmts | 30,226 stmts | -430 (-1.4%) | improved |

## Latest Per-Canary Breakdown

| Canary | Reqs | Req B | Res B | Redundant B | Head Re-reads | API Stmts | Pure Repeats | Client SQL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `DeviceFirstOfflineRequestVolume` | 0 | 0 | 0 | 0 | 0 | 1,389 | 61 | 5,141 |
| `DualPaneProvider.groupsRequestVolume` | 75 | 681,592 | 502,697 | 35,629 | 6 | 2,516 | 141 | 8,901 |
| `DualPaneProvider.sharing` | 42 | 104,424 | 322,169 | 32,107 | 2 | 9,567 | 536 | 37,173 |
| `ExplorerUploadRequestVolume` | 5 | 34,558 | 2,176 | 384 | 0 | 1,032 | 62 | 2,502 |
| `FolderMutationRequestVolume` | 24 | 114,602 | 44,701 | 8,832 | 6 | 1,615 | 82 | 7,411 |
| `GroupMutationRequestVolume` | 31 | 165,104 | 229,222 | 24,168 | 3 | 2,474 | 160 | 9,383 |
| `OrganizationBootstrapRequestVolume` | 22 | 486,205 | 38,520 | 5,203 | 1 | 1,918 | 93 | 4,468 |
| `PaneReconnectRequestVolume` | 19 | 5,127 | 62,073 | 2,424 | 0 | 3,091 | 131 | 14,025 |
| `PaneRestartRequestVolume` | 42 | 16,072 | 59,349 | 2,165 | 0 | 7,844 | 409 | 34,418 |
