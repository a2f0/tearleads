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
Repeated online authorization reads also add latency; deduplication must preserve
current access checks, artifact validation and operation lifetimes.
