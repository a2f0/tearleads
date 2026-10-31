# Principal-history acceptance

Principal history length imposes no lifetime version limit on revocation or
recovery. Cold verification still checks every signed transition, across bounded
HTTP requests and authenticated durable progress.

Runtime prefetch skips individually unavailable references and stops quietly on
cancellation, so one missing citation does not block unrelated containers.
Signed integrity failures still reject the batch. Exact resolution always
rejects missing custody or unavailable evidence; prefetch success never
authorizes an object.

## Integration coverage

| Requirement | Production behavior and regression |
| --- | --- |
| Revocation beyond 16,384 versions | [`packages/api/test/slow/principalHistoryAvailability.test.ts`](../packages/api/test/slow/principalHistoryAvailability.test.ts) constructs complete signed group and directory histories through 16,384, commits a compound membership revocation to 16,385, and denies the removed reader. |
| Cold historical access | The same test removes verification hints, restarts the API and creates a fresh SDK database. The surviving member recovers historical document plaintext without another device or a repair write. |
| Bounded HTTP work | A separate loopback proxy enforces 15 seconds through every response body, including mutation requests. Each request must use fewer than 1,024 SQL statements; mutation responses stay below 200 KB and recovery responses below 400 KB for the fixture's fixed policy sizes. |
| Interrupted preparation | The isolated fixture kills the API after its first completed preparation response. Durable progress survives, and the original compound mutation completes once after restart. |
| Uncertain final commit | `policyJournalOutcome.test.ts`, `policyJournalProcess.test.ts` and `groupOperationJournalProcess.test.ts` withhold a committed acknowledgement, advance the policy, then recover the original exact receipt from a fresh client. They cover compound, organization, creation and deletion operations. |
| Moving heads and malicious evidence | API-client page tests enforce pinned artifacts and contiguous cursors. SDK and crypto suites reject substituted pages, disconnected histories, forged authority, rollback, equivocation, expired lifetimes and conflicting dependency pins. |
| Bounded runtime consumers | Built-in mutations, sharing, metadata/name reads, history views and projection recovery require private paged evidence. Missing custody or failed paging cannot select full-history recovery. Offline verification requires authenticated local evidence. |
| Scheduling | Each API process permits two preparation workers per database, one active page per principal, two queued requests per principal and 64 overall. Queue expiry/refusal preserves continuation and does not impose a lifetime history limit. |

The mutation journal requires an explicit signed kind for every route and
rejects records without one. Regressions also prove that an unprotected complete
local bundle cannot replace private runtime recovery.

## Reproduction

Build the SDK before API tests. From [`packages/api`](../packages/api/), use a
dedicated fixture database and run:

```sh
API_DATABASE=sqlite API_SQLITE_PATH=/tmp/history-acceptance.sqlite \
  PRINCIPAL_HISTORY_ISOLATED_SERVER=1 \
  bun test test/slow/principalHistoryAvailability.test.ts
```

For networked PostgreSQL, initialize a dedicated database with
[`packages/api-shared/drizzle/0000_greenfield_baseline.sql`](../packages/api-shared/drizzle/0000_greenfield_baseline.sql),
set `API_DATABASE=postgres` and `DATABASE_URL`, and run the same test. Omit
`PRINCIPAL_HISTORY_THROUGH_VERSION` to exercise 16,384 signed predecessors; a
smaller value is a short diagnostic, not boundary acceptance. The regular API
suite runs a 64-version isolated SQLite case in
`principalHistoryProcessRecovery.test.ts`.

The log records wall time, HTTP latency and bytes, SQL statements and isolated
server memory samples. It reports retained heap after explicit GC separately
from sampled RSS and heap peaks. See [measurement
details](principal-history-transport.md#measuring-http-work).

## Concurrent prefix publication

Repeated recovery of identical current artifacts preserves the completed
prefix's sealed progress. A reader therefore cannot invalidate a pending
acknowledgement merely by resealing its unchanged predecessor. The signed
regression in `retainAcknowledgedPrincipalCurrents.recoveryRace.test.ts` fails
if that preservation is removed. Explicit replacement of a rejected prefix still
works; conflicting pins, changed prefixes and overlapping acknowledgements
retain their atomic rejection checks.

If a durable principal checkpoint advances after scoped recovery completes,
projection admission obtains one fresh recovery batch and checks the latest pins
again. It never admits the older result. Conflicting checkpoints and confirmed
server rollback remain terminal. The signed regressions in
`runtimePolicyRecoveryCheckpointRace.test.ts` reproduce the race for both the
target and its dependency, fail without the refresh, and preserve rollback
rejection.

## Ordinary workflow cost

Private metadata-root authority and scoped projection recovery add bounded
directory and group reads. A completed stage of the exact pinned head is used
without a confirmation read, and one operation discovers the directory once and
shares the recovered view across its collections. An operation is one
reconciliation pass (container hydration, document discovery) or one user
workflow (a document move's link and unlink legs) that mints an operation token,
or otherwise one policy warmer. That view never outlives the operation; an
organization read-model hint, a durable pin past a head it names, or the end of
the producing lease evicts it first. Every operation still observes the
server-current head and live read authorization of the organization policy; see
[warm projection request
cost](principal-history-transport.md#warm-projection-request-cost). Discovery
names the directory head the device holds, so an unchanged head costs a bare
head reply instead of a page. Principal mutation flows keep a fresh batch per
authority load, so their reads after a commit or a refused predecessor still
rediscover. The current per-workflow budgets are listed under [current-policy
request costs](developer/current-principal-consumers.md#request-costs).

`principalPolicyCacheForVerifiedPolicies` retains signatures and exact
references but does not bind entries to an organization, dependency set or live
recovery lease. Built-in verifiers therefore consult the scoped resolver before
that cache, even for entries produced earlier in the same caller. Current-only
entries with `retainedHistory` never take the bare-cache path, and a complete
cached history cannot bypass scoped resolution.
`runtimePolicyRecoveryLocal.test.ts` proves that a held full bundle cannot
replace protected evidence; recovery tests also reject expired lifetimes and
changed or conflicting dependency pins. Reuse of a completed stage keeps those
checks: its stored current artifacts are verified against the authenticated
history, the durable checkpoint is reloaded and compared, and a stored current
that fails verification is replayed online instead of refused.

## Limits of the evidence

These are local HTTP and network-database tests with fixed policy membership,
grant cardinality and single-entry size, not measurements of deployed Cloudflare
infrastructure or estimates for arbitrary policy sizes. Fixture generation and
thousands of requests take minutes; the deadline applies separately to each
request. A large individual state remains an indivisible verification step.
Preparation budgets are scheduling targets, not universal memory or latency
bounds.

The worker limits apply per API process, not across replicas. Retained signed
evidence and exact outcome receipts grow with accepted history. Disposable index
nodes and old protection generations have no automatic reclamation. Discovery
reads remain one per pass or workflow operation. Freshness is established at
the start of the pass rather than of each step: a change during a pass is
caught by hint eviction, durable pins, and the server's refusal of a stale
principal-policy reference on every write. Sharing a view across passes would
need a freshness argument that the per-pass read supplies.
