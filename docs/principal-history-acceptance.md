# Principal-history acceptance

Issues [#2442](https://github.com/a2f0/tearleads/issues/2442) and
[#2448](https://github.com/a2f0/tearleads/issues/2448) concern lifetime revocation
and recovery availability. History length no longer imposes a 16,384-state
refusal. Cold verification still checks every signed transition, across bounded
HTTP requests and authenticated durable progress.

Runtime prefetch skips individually unavailable references and stops quietly on
cancellation, so one missing citation does not block unrelated containers. Signed
integrity failures still reject the batch. Exact resolution always rejects missing
custody or unavailable evidence; prefetch success never authorizes an object.

## Integration coverage

| Requirement | Production behavior and regression |
| --- | --- |
| Revocation beyond the old cutoff | `packages/api/test/slow/principalHistoryAvailability.test.ts` constructs complete signed group and directory histories through 16,384, commits a compound membership revocation to 16,385, and denies the removed reader. |
| Cold historical access | The same test removes verification hints, restarts the API and creates a fresh SDK database. The surviving member recovers historical document plaintext without another device or a repair write. |
| Bounded HTTP work | A separate loopback proxy enforces 15 seconds through every response body, including mutation requests. Each request must use fewer than 1,024 SQL statements; mutation responses stay below 200 KB and recovery responses below 400 KB for the fixture's fixed policy sizes. |
| Interrupted preparation | The isolated fixture kills the API after its first completed preparation response. Durable progress survives, and the original compound mutation completes once after restart. |
| Uncertain final commit | `policyJournalOutcome.test.ts` and the principal journal process tests withhold a committed acknowledgement, advance the policy, then recover the original exact receipt from a fresh client. They cover compound, organization, creation and deletion operations. |
| Moving heads and malicious evidence | API-client page tests enforce pinned artifacts and contiguous cursors. SDK and crypto suites reject substituted pages, disconnected histories, forged authority, rollback, equivocation, expired lifetimes and conflicting dependency pins. |
| Bounded runtime consumers | Built-in mutations, sharing, metadata/name reads, history views and projection recovery require private paged evidence. Missing custody or failed paging cannot select full-history recovery. Offline verification requires authenticated local evidence. |
| Scheduling | Each API process permits two preparation workers per database, one active page per principal, two queued requests per principal and 64 overall. Queue expiry/refusal preserves continuation and does not impose a lifetime history limit. |

The greenfield mutation journal requires an explicit signed kind for every route.
It does not interpret older compound records with a missing kind. New regressions
also prove that an unprotected complete local bundle cannot replace private
runtime recovery.

## Measured boundary runs

Both isolated runs passed 4,142 assertions and 4,631 HTTP requests with no
15-second deadline failures. They used revision `dab40b58d629` on macOS with
SQLite and a separate local PostgreSQL server. Later runtime prefetch and metadata
repairs have separate focused regressions; these measurements describe that
revision, fixture and machine.

| Measurement | SQLite | Networked PostgreSQL |
| --- | ---: | ---: |
| Complete run, including signed fixture generation | 26m 29s | 32m 38s |
| Slowest HTTP request | 1.10 s | 4.36 s |
| Maximum SQL statements in one request | 413 | 423 |
| Largest mutation response | 101,151 bytes | 101,151 bytes |
| Largest cold recovery response | 325,825 bytes | 325,825 bytes |
| Maximum sampled server RSS | 307,347,456 bytes | 307,134,464 bytes |
| Maximum sampled server heap | 120,313,895 bytes | 133,499,904 bytes |
| Maximum retained server heap after GC | 32,950,618 bytes | 34,656,881 bytes |

The runs covered the mutation after API restart, revoked-reader denial, and cold
historical decryption after cache loss. Independent process tests also passed
for uncertain journal outcomes on both database backends.

## Reproduction

Build the SDK before API tests. From `packages/api`, use a dedicated fixture
database and run:

```sh
API_DATABASE=sqlite API_SQLITE_PATH=/tmp/history-acceptance.sqlite \
  PRINCIPAL_HISTORY_ISOLATED_SERVER=1 \
  bun test test/slow/principalHistoryAvailability.test.ts
```

For networked PostgreSQL, initialize a dedicated database with the greenfield
baseline, set `API_DATABASE=postgres` and `DATABASE_URL`, and run the same test.
Omit `PRINCIPAL_HISTORY_THROUGH_VERSION` to exercise 16,384 signed predecessors;
setting it to 64 is a short diagnostic, not boundary acceptance.

The log records wall time, HTTP latency and bytes, SQL statements and isolated
server memory samples. It reports retained heap after explicit GC separately
from sampled RSS and heap peaks. See [measurement details](principal-history-transport.md#measuring-http-work).

## Concurrent prefix publication

Repeated recovery of identical current artifacts preserves the completed
prefix's sealed progress. A reader therefore cannot invalidate a pending
acknowledgement merely by resealing its unchanged predecessor. The signed
regression in `retainAcknowledgedPrincipalCurrents.recoveryRace.test.ts` fails
without this fix. Explicit replacement of a rejected prefix still works;
conflicting pins, changed prefixes and overlapping acknowledgements retain their
atomic rejection checks.

If a durable principal checkpoint advances after scoped recovery completes,
projection admission obtains one fresh recovery batch and checks the latest pins
again. It never admits the older result. Conflicting checkpoints and confirmed
server rollback remain terminal. The signed regressions in
`runtimePolicyRecoveryCheckpointRace.test.ts` reproduce the race for both the
target and its dependency, fail without the refresh, and preserve rollback
rejection.

## Ordinary workflow cost

Private metadata-root authority and scoped projection recovery add bounded
directory and group reads. Before
[#2522](https://github.com/a2f0/tearleads/issues/2522) most of them re-read
heads the device had already verified: every projection verification confirmed
each completed public source with a pinned history read, every scoped recovery
confirmed its completed directory and Admins stages with a pinned policy read,
and every projection collection discovered the directory again. A completed
stage of the exact pinned head is now used without a confirmation read, and one
workflow operation (one policy warmer) discovers the directory once and shares
the recovered view across its collections. That view never outlives the
operation; an organization read-model hint, a durable pin past a head it names,
or the end of the producing lease evicts it first. Every operation still
observes the server-current head and live read authorization of the
organization policy; see
[warm projection request cost](principal-history-transport.md#warm-projection-request-cost).

The app's request-budget regressions measured these fixed fixtures:

| Workflow | Before | After | Policy reads after |
| --- | ---: | ---: | ---: |
| Single small Explorer upload | 33 | 10 | 3 |
| Personal organization bootstrap | 93 | 41 | 13 |
| Admins enrollment (add + settle) | 202 | 74–77 | 29–30 |
| Root attachment sharing (whole test) | 182 | 65–71 | 18–21 |

Provisioning later primed the founding organization, Admins and Members heads
and seeded discovery evidence for the profile documents it signed. Personal
bootstrap fell from 40 to 37 requests (13 to 11 policy reads), and creating and
activating another organization from 16 to 9 (7 to 1).

The sharing scenario's phases are timing-dependent; its whole-test count is the
stable comparison. Response bytes fell with the requests: the Admins enrollment
received about 2.46–2.56 MB instead of 4.31 MB, the sharing test about 2.0 MB
instead of 3.53 MB. Explicit per-route and aggregate budgets retain
mutation-count and response-byte checks. These are local fixed-cardinality
measurements, not estimates for arbitrary policy sizes or the earlier
full-boundary runs. Mutation flows keep a fresh batch per authority load, so
their reads after a commit or a refused predecessor still rediscover.

`principalPolicyCacheForVerifiedPolicies` retains signatures and exact
references but does not bind entries to an organization, dependency set or live
recovery lease. Built-in verifiers therefore consult the scoped resolver first,
even for entries produced earlier in the same caller. Current-only entries with
`retainedHistory` were already excluded from the bare-cache fast path on base
`461d5c324`; moving scoped resolution ahead of that cache removes the remaining
complete-history bypass. `runtimePolicyRecoveryLocal.test.ts` proves that a held
full bundle cannot replace protected evidence; recovery tests also reject
expired lifetimes and changed or conflicting dependency pins. Reuse of a
completed stage keeps those checks: its stored current artifacts are verified
against the authenticated history, the durable checkpoint is reloaded and
compared, and a stored current that fails verification is replayed online
instead of refused.

## Limits of the evidence

These are local HTTP and network-database tests, not measurements of deployed
Cloudflare infrastructure. Fixture generation and thousands of requests take
minutes; the deadline applies separately to each request. Policy membership,
grant cardinality and single-entry size are fixed by the fixture. A large
individual state remains an indivisible verification step. Preparation budgets
are scheduling targets, not universal memory or latency bounds.

The worker limits apply per API process, not across replicas. Retained signed
evidence and exact outcome receipts grow with accepted history. Disposable index
nodes and old protection generations currently have no automatic reclamation.
Future garbage collection must preserve concurrent readers and resumable rebuilds.
Discovery reads remain one per operation; sharing them across operations would
need a freshness argument that the per-operation read currently supplies.
