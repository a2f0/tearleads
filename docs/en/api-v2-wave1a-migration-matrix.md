# API v2 Admin Migration Matrix

This matrix tracks the current `tearleads.v2.AdminService` migration status for issue #2555.

Status legend:

- Landed: proto contract exists in `proto/tearleads/v2/admin.proto`, Rust handler path exists in `crates/api-v2/src/admin_service.rs`, and `api.adminV2` exposes the method in `packages/api-client/src/apiRoutes/adminV2Routes.ts`.

| Endpoint | Category | Value | Dependency | Blast | Auth | Payload | Owner | Status |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `AdminService.GetContext` | access scope | 3 | 2 | 2 | 4 | 1 | @a2f0 | Landed |
| `AdminService.GetPostgresInfo` | postgres read | 2 | 2 | 1 | 4 | 1 | @a2f0 | Landed |
| `AdminService.GetTables` | postgres read | 3 | 2 | 2 | 4 | 1 | @a2f0 | Landed |
| `AdminService.GetColumns` | postgres read | 3 | 2 | 2 | 4 | 1 | @a2f0 | Landed |
| `AdminService.GetRows` | postgres read | 3 | 2 | 2 | 4 | 2 | @a2f0 | Landed |
| `AdminService.GetRedisKeys` | redis read | 3 | 2 | 2 | 4 | 1 | @a2f0 | Landed |
| `AdminService.GetRedisValue` | redis read | 3 | 2 | 2 | 4 | 1 | @a2f0 | Landed |
| `AdminService.GetRedisDbSize` | redis read | 2 | 2 | 1 | 4 | 1 | @a2f0 | Landed |
| `AdminService.DeleteRedisKey` | redis write | 3 | 3 | 2 | 4 | 1 | @a2f0 | Landed |
| `AdminService.ListGroups` | group read | 3 | 3 | 2 | 4 | 1 | @a2f0 | Landed |
| `AdminService.GetGroup` | group read | 3 | 3 | 2 | 4 | 2 | @a2f0 | Landed |
| `AdminService.GetGroupMembers` | group read | 3 | 3 | 2 | 4 | 1 | @a2f0 | Landed |
| `AdminService.CreateGroup` | group write | 4 | 3 | 3 | 4 | 2 | @a2f0 | Landed |
| `AdminService.UpdateGroup` | group write | 4 | 3 | 3 | 4 | 2 | @a2f0 | Landed |
| `AdminService.DeleteGroup` | group write | 4 | 3 | 3 | 4 | 1 | @a2f0 | Landed |
| `AdminService.AddGroupMember` | group write | 4 | 3 | 3 | 4 | 2 | @a2f0 | Landed |
| `AdminService.RemoveGroupMember` | group write | 4 | 3 | 3 | 4 | 2 | @a2f0 | Landed |
| `AdminService.ListOrganizations` | organization read | 3 | 3 | 2 | 4 | 1 | @a2f0 | Landed |
| `AdminService.GetOrganization` | organization read | 3 | 3 | 2 | 4 | 1 | @a2f0 | Landed |
| `AdminService.GetOrgUsers` | organization read | 3 | 4 | 3 | 4 | 2 | @a2f0 | Landed |
| `AdminService.GetOrgGroups` | organization read | 3 | 3 | 2 | 4 | 2 | @a2f0 | Landed |
| `AdminService.CreateOrganization` | organization write | 4 | 3 | 3 | 4 | 2 | @a2f0 | Landed |
| `AdminService.UpdateOrganization` | organization write | 4 | 3 | 3 | 4 | 2 | @a2f0 | Landed |
| `AdminService.DeleteOrganization` | organization write | 4 | 3 | 3 | 4 | 1 | @a2f0 | Landed |
| `AdminService.ListUsers` | user read | 3 | 4 | 3 | 4 | 3 | @a2f0 | Landed |
| `AdminService.GetUser` | user read | 3 | 4 | 3 | 4 | 2 | @a2f0 | Landed |
| `AdminService.UpdateUser` | user write | 4 | 4 | 4 | 4 | 3 | @a2f0 | Landed |

## Notes

- Contract-first messages live in `proto/tearleads/v2/admin.proto`.
- Rust repository interfaces live in `crates/data-access-traits`.
- Native repository adapter crates live in `crates/data-access-postgres` and `crates/data-access-redis`.
- Contract-first trait-backed handler core lives in `crates/api-v2/src/admin_service.rs`.
- Shared pure normalization logic lives in `crates/api-domain-core` and is WASM-compatible.
- Rust-generated v2 contract crate lives in `crates/api-v2-contracts`.
- Browser-facing admin RPC routes use `api.adminV2` in `@tearleads/api-client`.
- `@tearleads/admin` consumes the canonical `api.adminV2` surface only.
- MLS browser/runtime traffic is v2-only (`tearleads.v2.MlsService`), and stale v1 MLS/admin proto files were removed from `proto/`.
