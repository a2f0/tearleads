# VFS Sharding Plan

Status: draft specification based on [issue #2612](https://github.com/a2f0/tearleads/issues/2612).

## Purpose

Define the shard-ready VFS schema shape up front so horizontal scaling can be introduced later without high-risk primary key and foreign key rewrites.

## Scope

This document covers:

- `vfs_registry` tenancy and key strategy
- Tenant propagation to direct FK consumers (`vfs_links`, `vfs_acl_entries`, `vfs_item_state`, `vfs_sync_changes`, `vfs_crdt_ops`, and related tables)
- Tenant-prefixed indexing for hot VFS paths
- Schema source-of-truth alignment (`packages/db` generators + API migrations)
- Constraint and boundary tests

## Verified Current State (March 3, 2026)

### Implemented

- API migration `v036` backfills and enforces `vfs_registry.organization_id` as `NOT NULL` in Postgres runtime schema.
- `vfs_registry_org_idx` is created in migration `v036`.

### Not Yet Shard-Ready

- No `tenant_id` exists on VFS tables in `packages/db` schema definitions/generated files.
- `vfs_registry` key remains single-column `id` (no composite tenant key or equivalent tenant-enforced uniqueness).
- Dependent table FKs reference only `vfs_registry(id)` without tenant locality guarantees.
- `packages/db` schema definitions still model `ownerId` and `organizationId` as nullable in `vfs_registry`, which diverges from migration `v036` runtime enforcement for `organization_id`.

## Required End State

### 1) Required Tenant Key

- Add `tenant_id` as required (`NOT NULL`) to all VFS rows that participate in identity, graph edges, policy, sync, and CRDT feeds.
- Tenant key must be immutable after insert.

### 2) Explicit Tenancy/Ownership Semantics

- Remove ambiguous nullable ownership semantics from tenancy boundaries.
- `tenant_id` is the authoritative shard boundary.
- `owner_id` and `organization_id` semantics must be explicit and enforceable (no implicit fallback behavior).

### 3) Shard-Ready Identity Keying

- `vfs_registry` must use either a composite primary key `(tenant_id, id)` or an equivalent strategy that still forces tenant-local FKs and tenant-scoped uniqueness.

If option 2 is chosen, tenant enforcement must remain declarative at schema level (not application-only).

### 4) Tenant-Local Foreign Keys

- All direct `vfs_registry` FK consumers must include tenant scope in keys and constraints.
- Parent/child edges in `vfs_links` must remain tenant-local.
- ACL/sync/CRDT records must be tenant-bound and unable to reference cross-tenant items.

### 5) Tenant-Prefixed Indexes

Add indexes with `tenant_id` leading columns for hot paths:

- ownership and tenant-scoped registry lookups
- visibility/ACL reads
- sync feed hydration and cursor scans
- CRDT feed scans and compaction candidate lookups

### 6) Schema Generator + Migration Consistency

- Update `packages/db/src/schema/*` definitions.
- Regenerate Postgres + SQLite schema outputs from updated definitions.
- Ensure API migrations produce the same shape and constraints.
- Eliminate schema drift between generated definitions and runtime migration outcomes.

### 7) Tests and Guardrails

- Constraint tests for non-null tenant keys.
- FK integrity tests proving tenant-local relationships.
- Negative tests proving cross-tenant references are rejected.
- Index and query-shape tests for known sync/visibility hot paths.

## Table-Level Target Checklist

### `vfs_registry`

- Add required `tenant_id`.
- Adopt shard-ready PK/uniqueness strategy.
- Keep organization/owner semantics explicit and consistent with tenancy.

### `vfs_links`

- Add required `tenant_id`.
- Tenant-scoped FKs for `parent_id` and `child_id`.
- Tenant-scoped uniqueness for parent/child edge identity.

### `vfs_acl_entries`

- Add required `tenant_id`.
- Tenant-scoped `item_id` FK.
- Tenant-prefixed principal and active-grant indexes.

### `vfs_item_state`

- Add required `tenant_id`.
- Tenant-scoped `item_id` FK / PK strategy.

### `vfs_sync_changes`

- Add required `tenant_id`.
- Tenant-scoped `item_id` / `root_id` FKs.
- Tenant-prefixed changed-at and hydration indexes.

### `vfs_crdt_ops`

- Add required `tenant_id`.
- Tenant-scoped `item_id` FK.
- Tenant-prefixed cursor/order/source indexes.

## Acceptance Criteria for Issue #2612

Issue #2612 is complete when:

- Tenant boundary is explicit, required, and enforced in schema.
- Cross-table VFS relationships are tenant-local by FK design.
- Hot-path indexes are tenant-prefixed.
- `packages/db` generated shape and API runtime migrations agree.
- Tests prove tenant boundary integrity and key constraints.
