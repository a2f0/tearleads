# Registration artifact batching experiment

## Result

On October 26, 2026, batching each verified policy's current payload and member
envelopes reduced full SDK account registration from **878 to 834 SQL
statements (44 fewer, 5.0%)**. The reduction reproduced on local PostgreSQL and
in staging. All nine staging accounts registered, logged in, and revoked their
sessions successfully.

The latency result is inconclusive. The candidate's median was lower, but
baseline latency moved substantially during the experiment. Three serial
samples per deployment cannot establish a causal speedup or a population p95.

| Staging phase | Registration server time, seconds | Median | Statements per registration |
| --- | --- | --- | --- |
| Baseline A | 11.233, 8.885, 8.977 | 8.977 | 878, 878, 878 |
| Candidate B | 11.231, 7.016, 7.504 | 7.504 | 834, 834, 834 |
| Restored A | 12.520, 8.228, 12.661 | 12.520 | unavailable, 878, 878 |

| Staging phase | Median SDK registration, seconds | Median database timer, seconds | Worker CPU, seconds |
| --- | --- | --- | --- |
| Baseline A | 9.996 | 8.840 | 1.988, 2.020, 2.439 |
| Candidate B | 8.680 | 7.440 | 3.229, 2.021, 2.182 |
| Restored A | 13.772 | 11.718 | unavailable, 2.020, 3.587 |

The first restored registration's Cloudflare event was not received; its HTTP
status and server/database timings were captured. An initial-baseline logout
event was also absent. All candidate events matched, and every sample's
logout succeeded. Missing events are not treated as zero CPU or zero statements.

## What changed

`Access Plane & Keying` now reads a pinned state's payload and member envelopes
with a tagged `UNION ALL` when `Principal Policies` supplies verified history.
This saves one database command per such bundle without repeating the encrypted
payload for each member. The existing unique indexes serve both predicates;
there is no schema, isolation, locking, or protocol change.

Each call still reads fresh artifacts. Existing history verification and
`verifyPrincipalPolicyCurrent` still bind the payload and envelopes to the
signed state. The fallback for callers without verified history preserves its
existing query and missing-payload error order. No verified-policy cache was
introduced.

## Procedure and provenance

The database probe tooling shipped in [PR #2641](https://github.com/a2f0/tearleads/pull/2641).
Each phase below deployed a clean checkout with the normal API deploy script,
passed the public health check, and ran:

```sh
bun run perf:provision --env staging --samples 3 --cloudflare
```

The harness imported the same SDK and used fresh identities, SQLite WASM in
memory, atomic Trash provisioning, login, and logout. Samples were serial.
Each phase followed a deployment, but Worker coldness and actual placement were
not independently controlled. The initial baseline was collected while the
tooling PR's CI ran; the candidate and restored baseline were adjacent later.

| Phase | UTC start | Deployed commit | API version | Private report run ID |
| --- | --- | --- | --- | --- |
| Baseline A | 11:01:26 | `7f0ecef9ec7c6157fbe367a6b3c553357ed7e7c0` | 2429 | `e54a3553-34aa-49ab-91dc-f0492a640266` |
| Candidate B | 11:32:37 | `78d3b69674d4b21b8d305bc180abd115cf719d79` | 2428 | `0c7b7f55-beb5-403c-b8f8-57a8246e1b73` |
| Restored A | 11:36:01 | `8368944dd377817be1cdf7c984418b8e6e5d1d32` | 2426 | `ef35b58d-605c-4161-be00-940695eddfe9` |

Baseline A and restored A have the same source tree: the latter is the squash
merge of the former. Their commit-count API versions differ. Reports are under
`.test_files/performance/staging-<run-id>.json`; the aggregate is
`registration-batch-comparison.json` in that directory. These private reports
retain request IDs and created account IDs, not keys or credentials.

Staging was restored to merged `main` (`8368944dd`) and verified healthy.
The candidate remains on `perf/batch-principal-policy-artifacts`. The nine
remote accounts remain; all login sessions were revoked and local identity
keys discarded. This experiment did not deploy the candidate to production.

## CPU versus I/O

A contemporaneous staging database control, run
`b9893ee1-8c19-4da5-80df-ba41db20c545`, measured trivial-query means of
5.85–7.60 ms, while PostgreSQL execution was 0.032–0.036 ms. Twenty trivial
queries in one command took 8–9 ms. Its temporary Worker was deleted.
The earlier [production probe](../../packages/performance/database-baseline.md)
showed the same general pattern.

These controls support targeting serial round trips. They do not measure
PlanetScale CPU, lock waits, or execution time for the actual registration SQL.
The database timer includes driver, network, server, and scheduling delays;
Worker CPU overlaps it, so subtracting the two does not yield network time.
This experiment therefore does not establish that all registration delay is
network I/O or that a larger database instance would help.

The next useful diagnostic is bounded timing by query family during a real
registration, correlated with server-side plans or PlanetScale query telemetry.
That can separate repeated cheap reads from expensive execution or lock waits
before attempting larger batching changes.

## Validation

- Eleven focused tests passed on each of PGlite, SQLite, and PostgreSQL:
  artifact parity, empty and 64-member sets, pinned-state isolation,
  missing-payload behavior, fresh tamper detection, statement budgets, and
  registration rollback/retry.
- The new envelope-tamper test failed when the final verifier guard was removed
  and passed with that guard restored. Subsequent coverage also added an
  other-type payload decoy to exercise that query's principal-type predicate;
  removing the predicate made that parity test fail too.
- All 98 PostgreSQL concurrency tests passed. Three remote-Turso-specific tests
  were skipped; no remote Turso run was performed.
- TypeScript, architecture checks, and `check:fast` passed. Independent review
  of the deployed candidate found no blocking or major issues.

Tests and this report added after the deployed candidate do not change its
runtime implementation. The measured 44-statement saving is the firm result;
any end-to-end latency claim needs a larger, interleaved comparison.
