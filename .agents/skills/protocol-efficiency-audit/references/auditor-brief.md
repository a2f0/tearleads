# Auditor Brief

Send the selected auditor the shared brief with its placeholders filled, then
the waste-class list and exactly one section from [slices.md](slices.md).
Apply the limits in [`batching.md`](batching.md); a large slice may be several
queued work items.

## Shared brief

```text
You are the selected slice auditor on the Tearleads monorepo
(<REPO_ROOT>, revision <SHA>). READ-ONLY: do not edit, create, or delete files
in the repository, do not commit, and do not run state-changing git commands.
Save probes, logs, and evidence only under <SCRATCH_DIR>. You may run existing
tests and canaries. Do not spawn agents, invoke another skill, publish issues
or comments, or change external state. Reporting and any publication belong
to the coordinator.

Your exact work item and remaining coverage: <WORK_ITEM>
Budget: at most 25 tool calls; reserve the last five for triage and reporting.
Use targeted searches and reads, not whole-directory dumps. Save candidate
evidence as you go. At the limit, stop and report unchecked paths, unresolved
candidates, and the next concrete step. A partial slice is a valid batch
result; never call it complete. Do not expand scope to fill a quota.

Mission: find ways to make synchronization between packages/client-sdk and
packages/api cheaper and simpler without losing a capability. Waste is
measured in requests per operation, bytes per operation, SQL statements per
request, tables, and mechanisms (distinct ways of doing one job). Local CPU
spent verifying signatures is not waste; fetching again what the client has
already verified is.

Three rules bound every proposal:
- Capabilities are preserved: end-to-end opacity of content; client
  verification of access and key state against signed artifacts; signed write
  headers on every content record; fail-closed verification in both
  directions; the no-brick rule (a client never refuses data an honest server
  can produce, and no device depends on another device's cache); offline and
  local-first operation with durable intents; convergence under lossy hints;
  revocation by rotation; anti-rollback checkpoints; verifiable purge proofs;
  bounded pagination for arbitrarily large histories; realtime hint privacy.
  A proposal that gives one up is a capability trade: report it separately
  with the decision it needs.
- Encodings are fixed: JSON over HTTPS, WebSocket hint frames, canonical JSON
  for signed bytes, Loro binary updates, and the current cipher suites. Do not
  propose gRPC, Protocol Buffers, CBOR, MessagePack, binary framing, or
  compression. Route shapes, response shapes, and which fields travel are in
  scope.
- Greenfield: no compatibility shims, dual reads, rollout flags, or
  migrations. Routes, tables, and local schema may change freely. Earlier
  "will not fix" dispositions are candidates again if you answer the
  constraints they named.

Out of scope, do not report: <EXCLUSIONS>

Already decided or tracked; use as context, not as a reason to skip:
<KNOWN_DISPOSITIONS>

Changes since the last measurement are the least-examined code at this
revision; read their diffs first (`git show <sha>`):
<RECENT_COMMITS>

Read the coordinator's compact baseline at <BASELINE_FILE>, including the
measured per-endpoint tables under <MEASUREMENT_DIR>, then the exact sections
of docs/protocol-specification.md, docs/client-sync-ordering.md, and the
slice's domain documents relevant to your work item. Do not reload the whole
issue history or every document.

Quality bar: report only proposals traced through real code paths with
file:line evidence, with the request, table, or statement they remove named
exactly. For every removed request, name the verifier, cache miss, or
scheduler decision that issues it today. For every removed table, run the
reader and writer census (non-test `rg` for the table's Drizzle export) and
record the sites. Try to refute each candidate: is the data needed for a
capability above, does a security audit finding (#2266, #2329, #2365, #2485,
#2491) depend on it, does the saving merely move work to another route?
List plausible but untraced ideas separately as Estimated.

Measurement: canary logs with the profile recorder on are in
<MEASUREMENT_DIR>; read the per-endpoint tables, do not re-run the whole
suite. To re-measure one scenario, run from packages/app:
`DUAL_PANE_REQUEST_PROFILE=1 DUAL_PANE_REQUEST_PROFILE_DETAIL=1 bun test
<file>` through `<REPO_ROOT>/node_modules/.bin/agent-tool run --`, logging
to your scratch directory. Statement counts come from
`withDatabaseStatementCounter` in
packages/api-shared/src/adapters/databaseStatementCounter.ts, used from a
probe that drives the real route with API_DATABASE=memory. Probes import
repository modules by absolute path and run with
`<REPO_ROOT>/node_modules/.bin/agent-tool run -- bun test <absolute path>`
from the owning package directory. Probe at most two candidates, with one
harness-repair attempt each. The coordinator has checked
packages/client-sdk/dist at this revision: do not rebuild it or run bun
install.

Return the report itself as your final message, under 1,200 words, linking
longer evidence files rather than omitting evidence; the coordinator saves it
as report.md in your scratch directory. Do not write the report file
yourself. If any file write is refused, carry that content in the final
message instead of working around the refusal. For each proposal give:
a title; the slice; what it retires (requests per scenario, bytes, statements,
tables, or a mechanism) with numbers and their source (Measured, Traced, or
Estimated); file:line evidence for the current behavior; the proposed shape
(route, response, table, or local rule) in enough detail to estimate the
change; impact (High, Medium, Low) and risk (Low, Medium, High) using the
coordinator's definitions; a preserved-by line for each capability it
touches, or the explicit capability trade; security findings it touches and
why they stay fixed; docs, canary ceilings, and formal models that would
change; and prerequisites among your proposals. End with short lists of
checked paths and tables, refuted candidates with reasons, unchecked paths,
and next steps. Open the message with proposal ids with impact, coverage
status, and the next step.
```

Default `<EXCLUSIONS>`: billing routes and tables; root administration
routes; the website; cryptographic primitive and suite choice; UI rendering
cost; residuals `docs/security-guarantees.md` accepts; plus any exclusions
the user added.

Fill `<KNOWN_DISPOSITIONS>` with slice-relevant entries from the saved index:
the closeout dispositions (A1 to A3 durable deltas, B batched probes, C
inline projections), #2203, #2512 and its fix #2515, #2521, #1281, #1672,
the #2522 proposals already implemented or declined, and project memory.
Fill `<RECENT_COMMITS>` with commits relevant to the work item since the last
measurement and one line on what each changed. Fill
`<WORK_ITEM>` with exact paths, tables, and saved coverage or next steps on
resume. Point `<BASELINE_FILE>` at the compact baseline and
`<MEASUREMENT_DIR>` at the shared measurements, not the auditor's private
directory.

The coordinator may write the filled brief to `<SCRATCH_DIR>/brief.md` and
require the auditor to read it first.

## Waste classes to sweep

Append this list to every brief. Each class has a measured instance in the
repository's own request budgets or schema at the time of writing.

- **Re-read of verified heads.** The same policy head, manifest, or
  projection fetched more than once in one operation or session because the
  cache lacks a binding the verifier needs, not because the data could have
  changed. Count the reads per head.
- **N+1 per object.** A probe, listing, or projection issued per document,
  container, or blob when the operation knows the set up front.
- **Round trips that always travel together.** A create followed by its
  first sync; stage, part upload, then bind; a projection fetched immediately
  before the write that cites it; a read-model refresh after every policy
  write.
- **Hint-then-fetch.** A realtime frame that names an object and forces two
  or more HTTP reads to learn what the server knew when it published.
- **Response over-fetch.** A projection or bundle that returns history,
  bundles, or keyrings the client has already verified; compare bytes
  consumed at the call site with bytes received.
- **Derived tables.** A table whose rows are a function of a signed-artifact
  table (projection, index, verification cache). Name the query it answers
  and whether an index on the artifact table could serve it.
- **Zero-reader tables.** No non-test read site. Audit and ledger tables
  with no product or operator consumer.
- **Parallel mechanisms.** Two or more mechanisms for one job: tombstone
  tables, idempotency receipts, position markers (cursor, watermark, commit
  LSN, version vector, lane check, discovery sequence), intent tables.
- **Cold-path machinery on the hot path.** Paged private history,
  preparation workers, backpressure, and long deadlines paid by every
  ordinary write rather than only by cold recovery.
- **Serial where independent.** Awaited sequences whose steps share no data
  dependency, and barriers broader than the dependency they protect.
- **Recovery by full sweep.** Reconnect and startup paths that re-list or
  re-probe everything instead of asking for changes since a watermark.
- **Conservative page sizes.** History, pull, and listing page bounds that
  turn one logical read into several requests at fixture sizes.
- **Statement amplification.** Routes with high statement counts per request
  from per-row loops, repeated path resolution, or re-verification of stored
  artifacts on every read. Report it here only when the fix retires a table,
  route, or verification step; a query-shape or index fix alone belongs to
  `database-efficiency-audit`.
- **Rebuild on the client of what the server could serve verified.**
  Keyring and KEK-log rebuilds, policy chain walks, and listing merges that
  the server could precompute and the client could still verify.
- **Double persistence of one byte stream.** A snapshot and an update log
  holding the same bytes; projection text split from the row it projects
  without a query that needs the split.
