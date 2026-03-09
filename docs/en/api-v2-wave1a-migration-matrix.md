# API v2 Admin Migration Matrix

This matrix tracks the current `tearleads.v2.AdminService` migration status for issue #2555.

Status legend:

- Landed: The endpoint is fully migrated, meaning:
  - the proto contract exists in `proto/tearleads/v2/admin.proto`
  - the Rust handler path exists in `crates/api-v2/src/admin_service.rs`
  - the `api.adminV2` client exposes the method in `packages/api-client/src/apiRoutes/adminV2Routes.ts`

Owner: `@a2f0` for all endpoints.
Status: all endpoints are `Landed` as defined in the legend.

| Endpoint | Category | Value | Dependency | Blast | Auth | Payload |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `AdminService.GetContext` | access scope | 3 | 2 | 2 | 4 | 1 |
| `AdminService.GetPostgresInfo` | postgres read | 2 | 2 | 1 | 4 | 1 |
| `AdminService.GetTables` | postgres read | 3 | 2 | 2 | 4 | 1 |
| `AdminService.GetColumns` | postgres read | 3 | 2 | 2 | 4 | 1 |
| `AdminService.GetRows` | postgres read | 3 | 2 | 2 | 4 | 2 |
| `AdminService.GetRedisKeys` | redis read | 3 | 2 | 2 | 4 | 1 |
| `AdminService.GetRedisValue` | redis read | 3 | 2 | 2 | 4 | 1 |
| `AdminService.GetRedisDbSize` | redis read | 2 | 2 | 1 | 4 | 1 |
| `AdminService.DeleteRedisKey` | redis write | 3 | 3 | 2 | 4 | 1 |
| `AdminService.ListGroups` | group read | 3 | 3 | 2 | 4 | 1 |
| `AdminService.GetGroup` | group read | 3 | 3 | 2 | 4 | 2 |
| `AdminService.GetGroupMembers` | group read | 3 | 3 | 2 | 4 | 1 |
| `AdminService.CreateGroup` | group write | 4 | 3 | 3 | 4 | 2 |
| `AdminService.UpdateGroup` | group write | 4 | 3 | 3 | 4 | 2 |
| `AdminService.DeleteGroup` | group write | 4 | 3 | 3 | 4 | 1 |
| `AdminService.AddGroupMember` | group write | 4 | 3 | 3 | 4 | 2 |
| `AdminService.RemoveGroupMember` | group write | 4 | 3 | 3 | 4 | 2 |
| `AdminService.ListOrganizations` | organization read | 3 | 3 | 2 | 4 | 1 |
| `AdminService.GetOrganization` | organization read | 3 | 3 | 2 | 4 | 1 |
| `AdminService.GetOrgUsers` | organization read | 3 | 4 | 3 | 4 | 2 |
| `AdminService.GetOrgGroups` | organization read | 3 | 3 | 2 | 4 | 2 |
| `AdminService.CreateOrganization` | organization write | 4 | 3 | 3 | 4 | 2 |
| `AdminService.UpdateOrganization` | organization write | 4 | 3 | 3 | 4 | 2 |
| `AdminService.DeleteOrganization` | organization write | 4 | 3 | 3 | 4 | 1 |
| `AdminService.ListUsers` | user read | 3 | 4 | 3 | 4 | 3 |
| `AdminService.GetUser` | user read | 3 | 4 | 3 | 4 | 2 |
| `AdminService.UpdateUser` | user write | 4 | 4 | 4 | 4 | 3 |

## Notes

- Contract-first messages live in `proto/tearleads/v2/admin.proto`.
- Rust repository interfaces live in `crates/data-access-traits`.
- Native repository adapter crates live in `crates/data-access-postgres` and `crates/data-access-redis`.
- Contract-first trait-backed handler core lives in `crates/api-v2/src/admin_service.rs`.
- Shared pure normalization logic lives in `crates/api-domain-core` and is WASM-compatible.
- Rust-generated v2 contract crate lives in `crates/api-v2-contracts`.
- Browser-facing admin RPC routes use `api.adminV2` in `@tearleads/api-client`.
- `@tearleads/app-admin` consumes the canonical `api.adminV2` surface only.
- MLS browser/runtime traffic is v2-only (`tearleads.v2.MlsService`), and stale v1 MLS/admin proto files were removed from `proto/`.
