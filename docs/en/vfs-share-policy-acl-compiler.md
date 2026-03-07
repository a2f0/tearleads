# VFS Share-Policy ACL Compiler

Status: implementation snapshot (March 7, 2026).

This document describes the ACL compiler currently implemented in:

- `packages/api/src/lib/vfsSharePolicyCompiler.ts`
- `packages/api/src/lib/vfsSharePolicyCompilerCore.ts`
- `packages/api/src/lib/vfsSharePolicyCompilerMaterialization.ts`
- `packages/api/src/lib/vfsSharePolicyCompilerState.ts`

It focuses on how it works today, known limitations, and edge cases verified in
tests.

## Scope

The compiler materializes share-policy intent into item-level rows in
`vfs_acl_entries` plus provenance in `vfs_acl_entry_provenance`.

Inputs:

- `vfs_share_policies`
- `vfs_share_policy_selectors`
- `vfs_share_policy_principals`
- Scoped `vfs_registry` + `vfs_links` graph

Outputs:

- Effective allow/deny ACL rows per `(item_id, principal_type, principal_id)`
- Provenance metadata (source policy/selector, precedence, compiler run id)

## Pipeline

1. Load state (`loadSharePolicyState`)
- Optionally scope by explicit `policyIds`.
- Build a graph closure from policy roots using a recursive `vfs_links` query.
- Load only registry rows in that closure.

2. Compile in memory (`compileSharePolicyCore`)
- Filter to active policies only:
  - `status === 'active'`
  - `revoked_at IS NULL`
  - `expires_at IS NULL OR expires_at > now`
  - `root_item` object type is in `VFS_CONTAINER_OBJECT_TYPES`
- Evaluate selector matches against each policy root scope.
- Aggregate to one effective decision per `(item, principal)`.

3. Materialize (`materializeCompiledDecisions`)
- Upsert into `vfs_acl_entries`.
- Upsert derived provenance row.
- Preserve direct grants except where policy result is deny (details below).

4. Revoke stale derived ACLs
- Find previously derived ACLs not touched in this run.
- Soft-revoke corresponding ACL entries (when not direct-protected).
- Rewrite derived provenance for stale entries as deny with null source ids.

5. Emit metrics/telemetry
- Optional callback + structured JSON event
  (`event: vfs_share_policy_compile_run`).

## Core Semantics

### Match modes

Selector anchor defaults to policy root when `anchor_item_id` is null.

- `exact`: depth 0 only
- `children`: direct children (`minDepth=1`), plus root if `includeRoot=true`
- `subtree`: descendants (`minDepth=1`), plus root if `includeRoot=true`

`max_depth` is clamped to `>= 0` when provided.

### Scope containment

Matches are always intersected with the policy root subtree. A selector anchored
outside root produces no decisions.

### Object type filter

`object_types` is optional. Empty/whitespace-only values are ignored. When
present, match is exact string equality against `vfs_registry.object_type`.

### Precedence and tie-breaks

For each `(item, principal)` aggregate:

- Any matching `exclude` selector produces a deny candidate.
- Deny wins over allow.
- Among allows, strongest access wins (`admin > write > read`).
- If allow ranks tie: lower `selector_order` wins, then lexicographically
  smaller `policy_id`, then `selector_id`.
- For deny source tie-break, same ordering rule applies.

The final decision list is deterministic and sorted by a stable composite key.

## Materialization Rules

### Ids

- ACL id: `policy-compiled:<principalType>:<principalId>:<itemId>`
- Derived provenance id: `policy-derived:<aclEntryId>`

### Direct-provenance protection

`ON CONFLICT (item_id, principal_type, principal_id)` updates are allowed only
when:

- incoming decision is deny (`revoked_at` set), or
- existing row is already revoked, or
- existing row has no `direct` provenance

Result:

- Policy allow does not overwrite an active direct grant.
- Policy deny can revoke an active direct grant.

### Batched writes

- Decisions `< 50`: per-row writes
- Decisions `>= 50`: batched writes (`UNNEST`) in chunks of 500

### Stale derived handling

Stale derived rows are not deleted. They are soft-revoked and provenance is
rewritten to deny/null-source markers for auditability and idempotence.

## Operational Knobs

Defaults:

- `maxExpandedMatchCount = 500000`
- `maxDecisionCount = 250000`
- `lockTimeoutMs = 5000`
- `statementTimeoutMs = 120000`

Env overrides:

- `VFS_SHARE_POLICY_COMPILER_MAX_EXPANDED_MATCH_COUNT`
- `VFS_SHARE_POLICY_COMPILER_MAX_DECISION_COUNT`
- `VFS_SHARE_POLICY_COMPILER_LOCK_TIMEOUT_MS`
- `VFS_SHARE_POLICY_COMPILER_STATEMENT_TIMEOUT_MS`
- `VFS_SHARE_POLICY_COMPILER_EMIT_METRICS`

Behavior:

- `dryRun=true` skips all writes and defaults to non-transactional mode.
- Non-dry runs default to transactional mode with advisory xact lock:
  `pg_advisory_xact_lock(hashtext(lockKey))`.
- Invalid guardrail/timeout values fail fast.

## Edge Cases To Know

- Empty/blank `policyIds` normalize to empty set and short-circuit with zero
  queries.
- Unsupported root object type (for example `note`) causes policy to be skipped.
- Missing selector anchor in registry yields no matches.
- `expires_at <= now` is considered inactive.
- Invalid date strings in policy rows parse to `null` and are treated as
  non-expired/non-revoked.
- Cycles in link graph are handled by shortest-depth visitation; traversal does
  not recurse infinitely.
- `expandedMatchCount` counts selector-item expansions before principal
  multiplication.
- Preview tree (`buildSharePolicyPreviewTree`) reads current ACL state only; it
  does not run compilation.

## Current Limitations

1. Compiler execution is not automatically wired to policy CRUD in API handlers;
   runtime use is currently explicit (for example drift-repair CLI / direct
   library calls).
2. Incremental impacted-policy resolver uses a hard depth cap of 50
   (`RECOMPUTE_SCOPE_MAX_DEPTH`), so deep policy scopes can be missed by
   incremental targeting.
3. Full compile is in-memory and can still be expensive for large policy ×
   selector × principal fanout.
4. Only the winning source is persisted in derived provenance; competing matched
   sources are not retained for explainability.
5. Root container eligibility is hardcoded (`folder`, `emailFolder`,
   `playlist`, `contact`).
6. Stale derived entries are revoked, not deleted, so table growth relies on
   later cleanup strategy.
7. Group/organization membership expansion is outside this compiler; it assumes
   principals are already concrete target ids.

## Related Tests

- `packages/api/src/lib/vfsSharePolicyCompilerCore.test.ts`
- `packages/api/src/lib/vfsSharePolicyCompilerCore.containerRoots.test.ts`
- `packages/api/src/lib/vfsSharePolicyCompiler.materialization.test.ts`
- `packages/api/src/lib/vfsSharePolicyCompiler.materializationGuards.test.ts`
- `packages/api/src/lib/vfsSharePolicyCompiler.concurrency.test.ts`
- `packages/api/src/lib/vfsSharePolicyCompiler.guardrails.test.ts`
- `packages/api/src/lib/vfsSharePolicyRolloutDeterminism.test.ts`
- `packages/api/src/lib/vfsSharePolicyRolloutPerformance.test.ts`
