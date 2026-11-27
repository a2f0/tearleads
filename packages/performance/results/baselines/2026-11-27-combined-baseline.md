# Combined protocol and database baseline, 2026-11-27

Captured on clean `main` (`dd507ff3b`) on an Apple M2 Pro with Bun 1.4.3 using
the combined visibility harness:

```sh
bun run build:runtime
bun run perf:canaries --statements --param-hash \
  --client-statements --payload-audit
bun run perf:inventory --canaries .test_files/performance/canaries-<id>.json
DATABASE_URL="postgres://$USER@localhost:5432/<scratch>" \
  bun run perf:plans --capture <combined-statements.jsonl> --limit 25
```

All nine request-volume canaries passed in 140.8 s (one sample each). Counts
reflect the in-process test API on PGlite and the in-memory object store, plus
local PostgreSQL `EXPLAIN (GENERIC_PLAN)` over the top 25 normalized `SELECT`
queries across the nine captures. Dual-pane canaries sum both panes.

## Compactness scorecard

| Dimension | Source | Baseline (`dd507ff3b`) |
| --- | --- | ---: |
| API Postgres tables / columns / indexes | `perf:inventory` | 57 / 572 / 183 (17 migrations) |
| Client SQLite tables / columns / indexes | `perf:inventory` | 62 (57 SDK + 5 app) / 468 / 97 |
| OpenAPI operations / 2xx fields / unreferenced leads | `perf:inventory` | 99 (94 paths) / 405 / 6 |
| Canary requests (deduplicated payload audit) | `perf:canaries --payload-audit` | 340 |
| Canary wire bytes (request / response) | `perf:canaries --payload-audit` | 1,609,388 B / 1,492,859 B |
| Echoed + redelivered + re-downloaded response bytes | `perf:canaries --payload-audit` | 198,160 B (13.3% of response) |
| Exact-head policy re-reads / `x-known-manifests` cites | `perf:canaries --payload-audit` | 42 / 1,009 |
| API statements (total / in-tx / lock-hold) | `perf:canaries --statements` | 36,917 / 30,818 / 22,243 |
| API same-key repeats (pure read / read-after-write) | `perf:canaries --statements --param-hash` | 4,788 (4,264 pure / 524 RAW) |
| Client SQLite statements / in-lock / total duration | `perf:canaries --client-statements` | 131,503 / 81,786 / 13,173 ms |
| Client SQLite mutations / max hold / max wait | `perf:canaries --client-statements` | 18,142 / 61.8 ms / 34.1 ms |
| Postgres generic-plan warnings (top 25 `SELECT`s) | `perf:plans` | 0 Seq Scan, 3 Sort/Materialize |
| Drifted canary request ceilings (`headroom > 0`) | `perf:inventory --canaries` | 6 phases |

## Per-canary summary

API statements cover the full canary file (including fixture setup); payload
totals cover the measured profile phases, deduplicating overlapping summary
windows such as `test total` and `create and add peer`.

| Canary | Wall | Reqs | Req B | Res B | Redundant B | Head rereads | API stmts (in-tx / pure rep) | Client SQLite (max hold) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `DeviceFirstOfflineRequestVolume` | 6.7 s | 0 | 0 | 0 | 0 | 0 | 1,557 (1,159 / 167) | 5,293 (27.3 ms) |
| `DualPaneProvider.groupsRequestVolume` | 8.6 s | 91 | 681,547 | 550,170 | 64,178 | 13 | 2,852 (2,363 / 283) | 9,202 (43.5 ms) |
| `DualPaneProvider.sharing` | 30.0 s | 47 | 104,409 | 340,523 | 42,247 | 5 | 11,197 (9,807 / 1,196) | 38,743 (61.8 ms) |
| `ExplorerUploadRequestVolume` | 4.7 s | 5 | 34,558 | 2,176 | 384 | 0 | 1,163 (798 / 125) | 2,557 (29.2 ms) |
| `FolderMutationRequestVolume` | 7.9 s | 35 | 116,478 | 83,143 | 19,533 | 11 | 1,867 (1,425 / 182) | 8,035 (27.9 ms) |
| `GroupMutationRequestVolume` | 9.3 s | 43 | 165,089 | 278,479 | 53,672 | 4 | 2,860 (2,388 / 284) | 9,670 (41.3 ms) |
| `OrganizationBootstrapRequestVolume` | 7.4 s | 27 | 486,190 | 41,626 | 5,651 | 3 | 2,267 (1,831 / 301) | 4,637 (26.9 ms) |
| `PaneReconnectRequestVolume` | 15.1 s | 24 | 5,097 | 74,732 | 3,418 | 3 | 3,545 (2,908 / 418) | 14,501 (28.7 ms) |
| `PaneRestartRequestVolume` | 51.1 s | 68 | 16,020 | 122,010 | 9,077 | 3 | 9,609 (8,139 / 1,308) | 38,865 (28.0 ms) |
| **Total** | **140.8 s** | **340** | **1,609,388** | **1,492,859** | **198,160** | **42** | **36,917 (30,818 / 4,264)** | **131,503 (61.8 ms max)** |

`Redundant B` sums echoed bytes (17,137 B), redelivered bytes already received
by the same pane (159,917 B), and re-downloaded upload bytes previously sent by
the same pane (21,106 B).

## Per-phase requests, wire bytes, WS hints, and ceilings

Phases that sent zero requests (`DeviceFirstOfflineRequestVolume` offline
steps, empty-folder/explorer-open steps, and `disconnect without pending work`)
are omitted.

| Canary | Phase | Reqs | Ceiling | WS hints | Req B | Res B |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `DualPaneProvider.groupsRequestVolume` | provisioning + settle | 42 | — | 0 | 551,554 | 56,650 |
| `DualPaneProvider.groupsRequestVolume` | open org manager + select Admins | 3 | — | 0 | 0 | 4,215 |
| `DualPaneProvider.groupsRequestVolume` | admin-group add + settle | 49 | — | 0 | 129,993 | 493,520 |
| `DualPaneProvider.groupsRequestVolume` | admin-group mutation + settle | 46 | — | 0 | 129,993 | 489,305 |
| `DualPaneProvider.sharing` | create note with attachment | 9 | — | 0 | 54,918 | 7,719 |
| `DualPaneProvider.sharing` | share root + post-share settle | 19 | — | 0 | 47,165 | 157,768 |
| `DualPaneProvider.sharing` | auto-discover shared note settle | 19 | — | 0 | 2,326 | 175,036 |
| `DualPaneProvider.sharing` | test total | 47 | — | 0 | 104,409 | 340,523 |
| `ExplorerUploadRequestVolume` | explorer single-file upload | 5 | 6 | 0 | 34,558 | 2,176 |
| `FolderMutationRequestVolume` | create child folder | 3 | 3 | 1 | 30,431 | 1,982 |
| `FolderMutationRequestVolume` | link document to folder | 2 | 2 | 0 | 9,076 | 687 |
| `FolderMutationRequestVolume` | unlink document from folder | 5 | 5 | 0 | 17,409 | 20,870 |
| `FolderMutationRequestVolume` | move document to trash | 4 | 4 | 0 | 26,228 | 8,223 |
| `FolderMutationRequestVolume` | move folder to trash | 10 | 10 | 2 | 16,608 | 19,931 |
| `FolderMutationRequestVolume` | restore folder from trash | 11 | 11 | 2 | 16,726 | 31,450 |
| `GroupMutationRequestVolume` | create first organization group | 6 | 9 | 1 | 27,594 | 19,097 |
| `GroupMutationRequestVolume` | add peer to first custom group | 28 | 41 | 3 | 74,875 | 241,107 |
| `GroupMutationRequestVolume` | create and add peer to first group | 34 | — | 0 | 102,469 | 260,204 |
| `GroupMutationRequestVolume` | create second organization group | 4 | 7 | 1 | 27,958 | 8,975 |
| `GroupMutationRequestVolume` | add peer to second custom group | 5 | 8 | 1 | 34,662 | 9,300 |
| `GroupMutationRequestVolume` | create and add peer to second group | 9 | — | 0 | 62,620 | 18,275 |
| `OrganizationBootstrapRequestVolume` | personal organization bootstrap | 21 | 21 | 2 | 275,777 | 28,325 |
| `OrganizationBootstrapRequestVolume` | additional organization creation + activation | 6 | 6 | 2 | 210,413 | 13,301 |
| `PaneReconnectRequestVolume` | reconnect without pending work | 9 | 9 | 1 | 2,228 | 16,820 |
| `PaneReconnectRequestVolume` | reconnect after peer folder create | 15 | 15 | 2 | 2,869 | 57,912 |
| `PaneRestartRequestVolume` | persisted pane restart | 16 | 16 | 1 | 3,031 | 32,738 |
| `PaneRestartRequestVolume` | settled restart with 2 notes | 10 | 10 | 1 | 2,244 | 14,969 |
| `PaneRestartRequestVolume` | settled restart with 8 notes | 9 | 10 | 1 | 2,230 | 18,794 |
| `PaneRestartRequestVolume` | settled restart with 8 folders | 10 | 10 | 1 | 3,430 | 20,937 |
| `PaneRestartRequestVolume` | settled restart, root refresh before crawl | 11 | 11 | 1 | 2,549 | 17,609 |
| `PaneRestartRequestVolume` | restart after a local edit | 12 | 12 | 1 | 2,536 | 16,963 |

Six phases currently sit below their asserted request ceiling (`headroom > 0`):
`GroupMutationRequestVolume` (`+13`, `+3`, `+3`, `+3`),
`ExplorerUploadRequestVolume` (`+1`), and `PaneRestartRequestVolume` (`+1` on
`settled restart with 8 notes`).

## Top API routes by statement volume

| Route | Reqs | Statements | In-tx | Lock-hold | Pure read repeats |
| --- | ---: | ---: | ---: | ---: | ---: |
| `POST /auth/register` | 25 | 10,175 | 10,125 | 10,075 | 2,050 |
| `POST /documents/{documentId}/sync` | 207 | 5,740 | 5,533 | 3,828 | 1,059 |
| `POST /containers/with-metadata-document` | 53 | 3,922 | 3,869 | 3,445 | 848 |
| `POST /documents` | 62 | 2,185 | 2,159 | 2,035 | 234 |
| `POST /containers/documents/query` | 152 | 1,742 | 0 | 0 | 0 |
| `GET /containers/{containerId}/writer-projection` | 112 | 1,623 | 1,623 | 0 | 0 |
| `GET /principals/{principalType}/{principalId}/policy` | 292 | 1,570 | 1,570 | 0 | 22 |
| `PUT /organizations/{organizationId}/groups/{groupId}/policy-commit` | 7 | 1,418 | 1,383 | 1,376 | 198 |
| `GET /documents/{documentId}/writer-projection` | 52 | 1,336 | 1,336 | 0 | 2 |
| `POST /containers/parent-lanes/query` | 75 | 1,145 | 0 | 0 | 57 |

89.1% of same-key repeats inside requests are pure read repeats (4,264 of
4,788) with no intervening write. The top pure read repeats across all nine
captures are:

| Extra sends | Query family |
| ---: | --- |
| 1,731 | Full principal state `UNION ALL` (`state`/`member`/`payload`/`envelope`) |
| 785 | `containers` joined with `access_manifests` |
| 610 | `principal_states` head lookup by `(principal_type, principal_id, version)` |
| 384 | Narrower principal state `UNION ALL` |
| 360 | `select "id", "organization_id" from "containers" where id in (...)` |

## Top client SQLite statements

Across all nine canaries, the SDK issued 131,503 local SQLite statements
(13,173 ms total, 81,786 inside 18,142 mutation locks, max 118 statements per
mutation, 61.8 ms peak hold, 34.1 ms peak wait). Excluding transaction controls
(`begin`/`commit`/`BEGIN IMMEDIATE`/`COMMIT`, 31,310 total), the hottest
local queries are:

| Count | Total ms | Query family |
| ---: | ---: | --- |
| 9,493 | 451 | `principal_policy_checkpoints` lookup by `(principal_type, principal_id)` |
| 8,778 | 713 | `trusted_user_identity_pins` lookup by trust domain + user/fingerprint |
| 8,525 | 385 | `principal_history_entries` lookup by `(scope_id, leaf_hash)` |
| 2,880 | 134 | `document_discovery_sequence` singleton read |

## PostgreSQL generic plans (`perf:plans`)

Of the top 25 normalized `SELECT` queries across all nine captures, 23 planned
cleanly via `EXPLAIN (GENERIC_PLAN)` and 2 were skipped (parameter-dependent
shapes). **Zero** produced `Seq Scan`; three produced `Sort`/`Materialize`
warnings:

- `with recursive ancestor_path as (...)` (651 executions): `Sort`
- `select ... from "access_manifest_heads" ...` (542 executions): `Sort`
- `select publication::text ... jsonb_agg(rows order by rows."discoveryOrder")`
  (371 executions): `Sort`, `Materialize`

## Static inventory (`perf:inventory`)

- **API Postgres:** 57 tables, 572 columns, 183 indexes across 17 migrations;
  0 left-prefix duplicate indexes; 0 unreferenced tables or columns.
- **Client SQLite:** 62 tables (57 SDK + 5 app projections), 468 columns, 97
  indexes; 0 left-prefix duplicate indexes; 0 unreferenced columns (4 app
  projection tables are registered dynamically by `appDocumentProjectors.ts`).
- **OpenAPI:** 99 operations across 94 paths (`GET`: 43, `POST`: 39, `PUT`: 11,
  `DELETE`: 6), 405 distinct 2xx response fields, 6 unreferenced field leads:
  `leaseExpiresAt` (`GET /root/reports/ops-health`), `levelDigest`
  (`GET /containers/{containerId}/writer-projection`), `omittedBundles` (both
  writer-projection routes), `portalUrl` (Stripe billing portal),
  `sealingSuite` (`GET /containers/{containerId}/kek-log`), and `stagedBytes`
  (baseline-stage routes).

See [Request-volume canaries](../../README.md#request-volume-canaries) and
[plans-and-inventory.md](../../plans-and-inventory.md) for measurement
boundaries and rerun commands.
