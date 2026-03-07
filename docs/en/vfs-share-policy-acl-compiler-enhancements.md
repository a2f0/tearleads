# VFS Share-Policy ACL Compiler Enhancements

Status: proposal document.

This document proposes practical improvements for the current share-policy ACL
compiler implementation.

## Prioritized Proposals

### 1) Auto-trigger compilation on policy graph writes

Problem:

- Compiler currently appears to run only when explicitly invoked.
- Policy/selector/principal/link changes can drift from effective ACL state.

Proposal:

- Trigger `runIncrementalSharePolicyRecompute` on:
  - policy create/update/revoke
  - selector/principal create/update/delete
  - root-scope link changes
  - relevant metadata changes
- Keep full compile (`repairVfsSharePolicyAclDrift`) as periodic safety net.

Impact:

- Reduces stale-ACL windows and manual repair reliance.

### 2) Replace fixed-depth impacted-policy scan with bounded work queue

Problem:

- Incremental impact resolver currently caps at depth 50.
- Deep trees can be missed for incremental recompute targeting.

Proposal:

- Replace single recursive CTE depth limit with chunked breadth-first expansion
  using a temporary work table or iterative query batches.
- Keep an explicit hard cap by processed node count (guardrail by work, not
  depth).

Impact:

- Better correctness on deep graphs while maintaining safety bounds.

### 3) Add compile diff/explain output

Problem:

- Today the compiler returns counts, not a detailed delta report.
- Harder to debug why a specific `(item, principal)` changed.

Proposal:

- Add optional explain mode that returns:
  - added/updated/revoked ACL ids
  - winning source (`policy_id`, `selector_id`, precedence)
  - skipped direct-protected decisions

Impact:

- Faster incident debugging and safer rollout validation.

### 4) Persist richer provenance for competing sources

Problem:

- Provenance stores only the winning source.
- No direct visibility into losing include/deny candidates.

Proposal:

- Add optional auxiliary table keyed by compiler run id that stores evaluated
  candidates (possibly sampled or capped).
- Keep current canonical provenance row unchanged for read path stability.

Impact:

- Better auditability and policy explainability without changing sync behavior.

### 5) Add DB-level selector validation constraints

Problem:

- Some selector shape validation is done in code; malformed data can still reach
  compile path.

Proposal:

- Add DB constraints/checks for:
  - `max_depth >= 0` when non-null
  - `selector_order >= 0`
  - `object_types` is JSON array of strings
- Optionally validate object type values against known VFS types.

Impact:

- Better data hygiene and fewer runtime surprises.

### 6) Improve large-run scalability

Problem:

- Compile core and aggregation are in-memory.
- Very large fanout can approach guardrail limits and memory pressure.

Proposal:

- Process policies in deterministic chunks and flush intermediate aggregates by
  principal partition.
- Consider SQL-assisted prefiltering for selector anchors/types to reduce match
  expansion before JS traversal.

Impact:

- More predictable memory and runtime for large tenants.

### 7) Add explicit cleanup policy for revoked derived rows

Problem:

- Stale derived rows are revoked, not deleted.
- Long-term growth can inflate ACL/provenance tables.

Proposal:

- Add retention-based cleanup job for derived rows that have stayed revoked past
  a grace period and are not direct-protected.
- Keep audit trail in separate history/event table if needed.

Impact:

- Controls table growth while preserving operational forensics.

### 8) Upgrade observability from console events to first-class metrics

Problem:

- Metrics are emitted as structured `console.info` JSON only.

Proposal:

- Export compiler counters/histograms via the project’s metrics pipeline
  (duration, decisions, stale revocations, guardrail trips, lock wait time).
- Attach scope dimensions (full vs scoped compile, policy filter size).

Impact:

- Better SLO-style monitoring and alerting.

## Suggested Rollout Sequence

1. Auto-trigger integration + diff/explain mode.
2. Impact resolver depth/work redesign.
3. Validation constraints and cleanup job.
4. Scaling refinements and richer provenance telemetry.

This order improves correctness first, then debuggability, then scale and
operational maturity.
