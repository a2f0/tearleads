# Soft-reset Terraform drift checks

The [soft-reset command](greenfield-reset.md#web-only-soft-reset-command)
checks refreshed resource observations as well as planned actions. A no-op
`resource_changes` list alone does not establish that identities or policies
are unchanged.

## Observation-only exception

In the PostgreSQL stack only, managed `update` entries in `resource_drift`
may differ in these explicitly listed response fields:

- `restapi_object.database`: `default_branch_table_count`, `ready`,
  `schema_last_updated_at`, `state`, `updated_at`.
- `restapi_object.main_protection`: `has_roles`, `latest_image_version`,
  `ready`, `schema_last_updated_at`, `state`, `updated_at`.

The [validator](../../scripts/deploy/softResetDrift.ts) compares both the
string-valued `api_data` map and the parsed JSON object in `api_response`.
It omits only the listed fields at each response's top level, then requires
strict structural equality. These are observations, not permission to change
configuration. All other top-level resource values, including `data`, IDs,
and paths, must match exactly. Malformed or unknown refreshed values refuse
this exception. No-op drift entries remain accepted as before.

Changes to deletion protection, identity, region, replicas, size, or any other
unlisted field still refuse, even if present in only one response representation.
Other PostgreSQL resources, deletes, and replacements are not exempt.
The same PostgreSQL check applies at preflight, destruction/creation plan
inspection, and post-recreation verification.

## Storage location casing exception

In the storage stack only, a managed `update` for exactly
`cloudflare_r2_bucket.blobs` may differ only in the casing of its `location`.
The [storage validator](../../scripts/deploy/softResetStorageDrift.ts) requires
two known string locations that differ in case but identify the same code:
`apac`, `eeur`, `enam`, `weur`, `wnam`, or `oc`. An actual region change,
unrecognized code, missing or malformed location still refuses.

Both snapshots must be objects with nonempty string `id`, `account_id`, and
`name`. Every other attribute must remain structurally identical; string
values are compared exactly, without normalizing identities, credentials,
serialized policy, or unknown properties. `after_unknown` may be omitted or
an empty object, but null, malformed, or populated markers refuse. Other
addresses (including downloads), stacks, modes, and actions are not exempt.

This exception applies to the storage no-op preflight and inspected saved
destroy/create plans. The current post-recreation `verify-fresh` phase checks
storage inventory and emptiness, but inspects only a PostgreSQL no-op plan;
it does **not** perform a post-recreation storage drift plan. The normal plan
scope, configured identities, token permissions, and inspected saved-plan-byte
checks remain mandatory for every plan, even alongside either exception.

## A refused run still needs manual recovery

Follow [timing records and manual recovery](greenfield-reset.md#timing-records-and-manual-recovery).
Inspect the failed phase and private evidence without publishing credentials or
plan values. For a preflight refusal, establish that no maintenance or data
phase ran. A metadata-only diagnosis does not authorize a reset, automatic
retry, refresh-only apply, or removal of a blocking lock. Reconcile actual
drift before a new authorized run; release only the identified failed run's
lock after recovery has been verified. Updating the command never cleans up
an earlier run or resumes its saved plans automatically.
