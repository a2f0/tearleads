# VFS Share Policy Precedence (Draft v1)

Status: design in progress for issue #2404 (child of #2400).

This document defines deterministic precedence and merge rules for
container-based share policies compiled to item-level ACL rows.

## Goal

Compile policy intent into one effective decision per `(item_id, principal)`
without runtime recursive ACL evaluation in sync queries.

## Non-goals

- No dynamic recursive permission walks in `/v1/vfs/vfs-sync` or CRDT sync.
- No implicit allow-wins behavior when a deny is present.

## Inputs

For each `(item_id, principal)` candidate, evaluate:

- `direct_grants`: manually managed grants
- `derived_allows`: policy-derived allow decisions
- `derived_denies`: policy-derived deny decisions (exclude rules)
- `revocations`: explicit revocation state
- `expiry`: active/inactive by time

## Effective decision contract

Compiler output is exactly one of:

- `DENY` (no effective grant row materialized)
- `ALLOW(read)`
- `ALLOW(write)`

`admin` is not emitted by policy compiler v1.

## Precedence rules

Apply in this order for each `(item_id, principal)`:

1. Remove inactive entries (`revoked` or expired).
2. If any active explicit deny exists, effective decision is `DENY`.
3. Else if any active direct grant exists, take strongest direct grant.
4. Else if any active derived allow exists, take strongest derived allow.
5. Else effective decision is `DENY`.

Strength ordering: `write > read`.

## Tie-breakers (determinism)

When same-precedence entries conflict at same strength:

1. Newer `updated_at` wins.
2. If same timestamp, lexical smallest stable source id wins.

Stable source id examples:

- direct: `direct:<acl_id>`
- derived allow: `policy-allow:<policy_id>:<selector_id>`
- derived deny: `policy-deny:<policy_id>:<selector_id>`

## Materialization rules

- Materialize one grant row only when effective decision is allow.
- Persist provenance metadata for every compiled allow:
  - `source_kind = derived`
  - `policy_id`
  - `compiled_at`
- Never overwrite direct grant provenance.
- Deletes/revokes of derived rows must be idempotent.

## Multi-policy merge behavior

For overlapping policies targeting same principal and item:

- `allow + deny => DENY`
- `read + write => ALLOW(write)` when no deny
- multiple allows => one deduped effective allow

## Multi-parent and graph guardrail

For inherited policy selectors traversing link graph:

- cycles are fail-closed
- ambiguous multi-parent paths must not escalate privilege
- explicit deny on any applicable path blocks effective allow

## Reference pseudocode

```text
for each (item_id, principal):
  active = filter_active(entries)
  if exists(active.deny):
    emit DENY
  else if exists(active.direct_allow):
    emit strongest(active.direct_allow)
  else if exists(active.derived_allow):
    emit strongest(active.derived_allow)
  else:
    emit DENY
```

## Test vectors (minimum)

1. `derived_allow(read)` only => `ALLOW(read)`
2. `derived_allow(write)` only => `ALLOW(write)`
3. `derived_allow(read) + derived_deny` => `DENY`
4. `direct_allow(read) + derived_allow(write)` => `ALLOW(read)`
5. `direct_allow(write) + derived_deny` => `DENY`
6. `derived_allow(write, expired)` => `DENY`
7. `derived_allow(read, revoked)` => `DENY`
8. same-level conflict with same permission uses timestamp/source-id tie-break

## Notes for v1

- Keep compiler as authoring/materialization layer.
- Keep sync visibility ACL-per-item.
- This contract is intentionally conservative (deny-wins) for least privilege.
