# Performance Epoch 2: Greenfield Protocol, Database & Realtime Optimization Pass

Structured longitudinal performance snapshots capturing schema, wire, API DB,
client SQLite, query plan, multi-party scenario, and scaling probe metrics
across greenfield optimization PRs. Started 2026-11-27T22:34:02.103Z.

## Checkpoints

| Checkpoint | Kind | Revision | PR | Issues | Label | Step Summary |
| --- | --- | --- | --- | --- | --- | --- |
| `000-baseline` | baseline | `53819b364` | — | #3263, #3289, #3291, #3342, #3353, #3396 | Main baseline (53819b364) | Epoch baseline |

## Cumulative Scorecard (`000-baseline` -> `000-baseline`)

| Dimension | Metric | Baseline | Latest | Delta | Verdict |
| --- | --- | ---: | ---: | ---: | --- |
| Schema | API Postgres tables | 57 tables | 57 tables | — | baseline |
| Schema | API Postgres indexes | 183 indexes | 183 indexes | — | baseline |
| Schema | API duplicate indexes | 0 indexes | 0 indexes | — | baseline |
| Schema | Client SQLite tables | 63 tables | 63 tables | — | baseline |
| Schema | Unread 2xx OpenAPI fields | 3 fields | 3 fields | — | baseline |
| Schema | Drifted canary ceilings | 14 phases | 14 phases | — | baseline |
| Wire | Canary requests | 340 reqs | 340 reqs | — | baseline |
| Wire | Canary request bytes | 1,609,389 B | 1,609,389 B | — | baseline |
| Wire | Canary response bytes | 1,492,860 B | 1,492,860 B | — | baseline |
| Wire | Canary redundant response bytes | 198,160 B | 198,160 B | — | baseline |
| Wire | Exact-head policy re-reads | 42 reads | 42 reads | — | baseline |
| API DB | Canary API SQL statements | 36,878 stmts | 36,878 stmts | — | baseline |
| API DB | Canary API in-tx statements | 30,788 stmts | 30,788 stmts | — | baseline |
| API DB | Canary API lock-hold statements | 22,227 stmts | 22,227 stmts | — | baseline |
| API DB | Canary API pure read repeats | 4,744 repeats | 4,744 repeats | — | baseline |
| Client SQLite | Canary client SQLite statements | 131,525 stmts | 131,525 stmts | — | baseline |
| Client SQLite | Canary SQLite tx controls | 32,446 stmts | 32,446 stmts | — | baseline |
| Client SQLite | Canary SQLite total duration | 13,058.2 ms | 13,058.2 ms | — | baseline |
| Client SQLite | Canary SQLite max lock hold | 49.4 ms | 49.4 ms | — | baseline |
| Plans | Postgres generic Seq Scans | 0 queries | 0 queries | — | baseline |
| Plans | Postgres generic Sort plans | 3 queries | 3 queries | — | baseline |
| Plans | Postgres generic Materialize plans | 1 queries | 1 queries | — | baseline |
| Scenarios | Bob-and-Alice HTTP requests | 4,975 reqs | 4,975 reqs | — | baseline |
| Scenarios | Bob-and-Alice API statements | 122,420 stmts | 122,420 stmts | — | baseline |
| Scenarios | Bob-and-Alice pure read repeats | 14,321 repeats | 14,321 repeats | — | baseline |
| Scenarios | Bob-and-Alice client SQLite | 486,496 stmts | 486,496 stmts | — | baseline |
| Reload | Settled reload requests (shared max tier) | 4 reqs | 4 reqs | — | baseline |
| Reload | Settled reload API statements | 62 stmts | 62 stmts | — | baseline |
| Reload | Settled reload client SQLite | 481 stmts | 481 stmts | — | baseline |
| Realtime | Realtime hub auth statements | 9 stmts | 9 stmts | — | baseline |
| Realtime | Realtime hub auth PG bytes | 1,383,651 B | 1,383,651 B | — | baseline |
| Rotations | Rotation group-shrink PG statements | 623 stmts | 623 stmts | — | baseline |
| Baselines | Baseline first-unlink PG statements | 102 stmts | 102 stmts | — | baseline |

## Latest Per-Canary Breakdown

| Canary | Reqs | Req B | Res B | Redundant B | Head Re-reads | API Stmts | Pure Repeats | Client SQL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `DeviceFirstOfflineRequestVolume` | 0 | 0 | 0 | 0 | 0 | 1,557 | 180 | 5,294 |
| `DualPaneProvider.groupsRequestVolume` | 91 | 681,547 | 550,170 | 64,178 | 13 | 2,847 | 338 | 9,202 |
| `DualPaneProvider.sharing` | 47 | 104,409 | 340,523 | 42,247 | 5 | 11,170 | 1,379 | 38,784 |
| `ExplorerUploadRequestVolume` | 5 | 34,558 | 2,176 | 384 | 0 | 1,163 | 151 | 2,558 |
| `FolderMutationRequestVolume` | 35 | 116,478 | 83,143 | 19,533 | 11 | 1,867 | 200 | 8,036 |
| `GroupMutationRequestVolume` | 43 | 165,089 | 278,479 | 53,672 | 4 | 2,860 | 344 | 9,672 |
| `OrganizationBootstrapRequestVolume` | 27 | 486,190 | 41,626 | 5,651 | 3 | 2,267 | 330 | 4,639 |
| `PaneReconnectRequestVolume` | 24 | 5,097 | 74,732 | 3,418 | 3 | 3,545 | 445 | 14,500 |
| `PaneRestartRequestVolume` | 68 | 16,021 | 122,011 | 9,077 | 3 | 9,602 | 1,377 | 38,840 |

## Latest Multi-Party Scenarios (`bob-and-alice`)

| Scenario | Reqs | 409s | Req B | Res B | API Stmts | Pure Repeats | Client SQL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `attachmentAccess` | 357 | 2 | 1,485,232 | 3,232,230 | 8,147 | 867 | 26,363 |
| `billingPurgeRecovery` | 193 | 2 | 1,353,774 | 1,463,645 | 5,024 | 571 | 16,677 |
| `concurrentFirstWriters` | 331 | 3 | 1,179,950 | 3,827,657 | 6,968 | 674 | 25,572 |
| `deviceFirstCatchUp` | 268 | 1 | 1,635,987 | 1,580,247 | 7,198 | 841 | 26,111 |
| `documentPurge` | 532 | 8 | 2,574,573 | 4,779,985 | 12,646 | 1,465 | 46,565 |
| `firstMemberAdd` | 59 | 0 | 759,613 | 379,171 | 2,441 | 300 | 5,357 |
| `groupShrinkCarry` | 1,354 | 18 | 4,167,001 | 19,633,963 | 34,006 | 4,136 | 151,165 |
| `multiLinkDocument` | 354 | 6 | 1,373,628 | 4,438,418 | 8,696 | 1,024 | 36,208 |
| `nestedTree` | 647 | 12 | 1,987,275 | 9,772,360 | 15,975 | 1,972 | 69,361 |
| `realtimeHints` | 136 | 2 | 956,291 | 651,886 | 4,056 | 521 | 13,369 |
| `rotationHistory` | 608 | 13 | 1,744,272 | 9,070,373 | 13,655 | 1,565 | 56,113 |
| `stagedBaseline` | 136 | 3 | 37,029,050 | 73,748,288 | 3,608 | 385 | 13,635 |

## Latest Reload Scaling

| Docs | Folders | Reload | Reqs | Settled ms | API Stmts | Client SQL |
| ---: | ---: | --- | ---: | ---: | ---: | ---: |
| 10 | 1 | first | 10 | 522 | 147 | 1,130 |
| 10 | 1 | settled | 4 | 197.5 | 53 | 427 |
| 13 | 1 | peer-edited | 13 | 590 | 232 | 1,665 |
| 100 | 10 | first | 6 | 527 | 96 | 2,947 |
| 100 | 10 | settled | 4 | 196.5 | 62 | 481 |
| 103 | 10 | peer-edited | 13 | 568 | 240 | 1,763 |

## Latest Realtime Hub Scaling

| Folders | Pass | Median ms | CPU ms | PG Stmts | Rows | PG Bytes |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 100 | declaration | 30 | 19.5 | 9 | 113 | 1,383,651 |
| 100 | revalidation | 30.7 | 18.4 | 9 | 113 | 1,383,651 |

## Latest Rotation & Revocation Scaling

| Phase | Rotations | Depth | Reqs | 409s | PG Stmts | Local SQL | Wall ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `group-share` | 1 | 3 | 11 | 0 | 398 | 1,976 | 1,189 |
| `group-share` | 4 | 3 | 11 | 0 | 398 | 1,976 | 1,118 |
| `group-shrink` | 1 | 3 | 12 | 1 | 622 | 3,403 | 1,496 |
| `group-shrink` | 4 | 3 | 12 | 1 | 623 | 3,439 | 1,643 |
| `stale-writer-repair` | 1 | 3 | 12 | 2 | 378 | 1,236 | 712 |
| `stale-writer-repair` | 4 | 3 | 12 | 2 | 400 | 1,282 | 951 |
| `direct-revoke` | 1 | 3 | 10 | 1 | 375 | 2,074 | 828 |
| `direct-revoke` | 4 | 3 | 10 | 1 | 378 | 2,111 | 958 |
| `grantee-subtree-repair` | 1 | 3 | 9 | 1 | 332 | 1,385 | 842 |
| `grantee-subtree-repair` | 4 | 3 | 9 | 1 | 349 | 1,410 | 1,083 |
| `subtree-move` | 1 | 3 | 6 | 0 | 180 | 1,302 | 518 |
| `subtree-move` | 4 | 3 | 6 | 0 | 180 | 1,322 | 648 |
| `fresh-reader-hydration` | 1 | 3 | 69 | 0 | 1,546 | 7,918 | 2,982 |
| `fresh-reader-hydration` | 4 | 3 | 69 | 0 | 1,553 | 8,123 | 3,362 |
| `roster-vouched-share` | 1 | 3 | 21 | 0 | 632 | 3,261 | 1,302 |
| `roster-vouched-share` | 4 | 3 | 21 | 0 | 633 | 3,281 | 1,470 |

## Latest Rotation Baseline Scaling

| Phase | MiB | Race | Mode | Reqs | PG Stmts | Local SQL | Peak RSS MiB |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: |
| `seed-history` | 1 | no | — | 4 | 103 | 593 | 139.7 |
| `seed-history` | 5 | no | — | 4 | 103 | 593 | 188.1 |
| `first-unlink-rotate` | 1 | no | inline | 4 | 101 | 1,124 | 32.3 |
| `first-unlink-rotate` | 5 | no | inline | 4 | 102 | 1,124 | 169.1 |
| `fresh-reader-sync` | 1 | no | — | 36 | 660 | 3,119 | 217.5 |
| `fresh-reader-sync` | 5 | no | — | 36 | 660 | 3,119 | 126.7 |
| `second-unlink-rotate` | 1 | no | inline | 4 | 100 | 1,430 | 54.9 |
| `second-unlink-rotate` | 5 | no | inline | 4 | 101 | 1,430 | 336 |
