# API v2 Wave 1A Migration Matrix

This matrix tracks the first DAL-proving admin read endpoints selected for v2 migration in issue #2555.

| Endpoint | Value | Dependency | Blast | Auth | Payload | Owner | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `AdminService.GetPostgresInfo` | 2 | 2 | 1 | 4 | 1 | @a2f0 | Contracts + traits + adapters + hardened handler wiring landed |
| `AdminService.GetTables` | 3 | 2 | 2 | 4 | 1 | @a2f0 | Contracts + traits + adapters + hardened handler wiring landed |
| `AdminService.GetColumns` | 3 | 2 | 2 | 4 | 1 | @a2f0 | Contracts + traits + adapters + hardened handler wiring landed |
| `AdminService.GetRows` | 3 | 2 | 2 | 4 | 2 | @a2f0 | v2 contract + handler + adapter flow landed; client/admin consumers now route to v2 |
| `AdminService.GetRedisKeys` | 3 | 2 | 2 | 4 | 1 | @a2f0 | Contracts + traits + adapters + hardened handler wiring landed |
| `AdminService.GetRedisValue` | 3 | 2 | 2 | 4 | 1 | @a2f0 | Contracts + traits + adapters + hardened handler wiring landed |
| `AdminService.DeleteRedisKey` | 3 | 3 | 2 | 4 | 1 | @a2f0 | Wave 1C write cutover landed on v2 transport + handler path |
| `AdminService.GetRedisDbSize` | 2 | 2 | 1 | 4 | 1 | @a2f0 | v2 contract/handler route landed; browser/admin consumers now on v2 |
| `AdminService.ListGroups` | 3 | 3 | 2 | 4 | 1 | @a2f0 | v2 contract + handler + harness landed; `@tearleads/admin` groups list now routes to v2 |
| `AdminService.GetGroup` | 3 | 3 | 2 | 4 | 2 | @a2f0 | v2 contract + handler + harness landed; browser/client/admin `groups.get` now routes to v2 |
| `AdminService.ListOrganizations` | 3 | 3 | 2 | 4 | 1 | @a2f0 | v2 contract + handler + harness landed; browser/client/admin organization list now routes to v2 |
| `AdminService.ListUsers` | 3 | 4 | 3 | 4 | 3 | @a2f0 | v2 contract + handler + harness landed; browser/client/admin user list now routes to v2 |

## Notes

- This slice establishes contract-first messages in `proto/tearleads/v2/admin.proto`.
- Rust repository interfaces live in `crates/data-access-traits`.
- Native repository adapter crates now live in `crates/data-access-postgres` and `crates/data-access-redis`.
- Contract-first trait-backed handler core lives in `crates/api-v2/src/admin_service.rs`.
- Handler boundary validation now rejects invalid identifiers, negative Redis limits, and blank Redis keys before repository calls.
- Internal/unavailable repository failures now return sanitized transport errors.
- Shared pure normalization logic lives in `crates/api-domain-core` and is WASM-compatible.
- Rust-generated v2 contract crate lives in `crates/api-v2-contracts`.
- Transport-level gRPC integration tests now cover Wave 1A admin RPC round-trips and auth metadata enforcement.
- Handler -> adapter -> gateway integration tests now cover Wave 1A admin read flows and auth short-circuit behavior.
- Browser-facing Wave 1A admin RPC routes now use gRPC-web binary transport in `@tearleads/api-client` via `api.adminV2`.
- Added test-harness override support for api-v2 client WASM importer via `__tearleadsImportApiV2ClientWasmModule`.
- Runtime harness now routes `/connect/tearleads.v2.AdminService/*` to a Rust `api-v2` Wave 1A harness service for frontend/runtime integration tests.
- Wave 1A read methods now route through the canonical `api.adminV2` surface (`GetPostgresInfo`, `GetTables`, `GetColumns`, `GetRedisKeys`, `GetRedisValue`).
- Wave 1C adds the first v2 admin write cutover: `DeleteRedisKey` now routes through `api.adminV2` over `/connect/tearleads.v2.AdminService/DeleteRedisKey`.
- Removed the `adminRoutes` compatibility module and retired `api.admin` from `@tearleads/api-client`; `api.adminV2` is now the only admin route surface there.
- MLS browser/runtime traffic is now v2-only (`tearleads.v2.MlsService`), and the Node v1 MLS service registration has been removed.
- Removed stale `tearleads/v1/mls.proto` contract artifacts and dropped its `proto/buf.yaml` lint-ignore entries after MLS transport cleanup landed via #2717.
- Removed the stale `tearleads/v1/mls.proto` breaking-ignore entry from `proto/buf.yaml` after retirement landed on `main`.
- Removed stale `tearleads/v1/admin.proto` contract artifacts from the active proto migration surface.
- Removed the stale `tearleads/v1/admin.proto` breaking-ignore entry from `proto/buf.yaml` after retirement landed on `main`.
- `@tearleads/admin` now exposes the canonical `api.adminV2` surface only; local `api.admin` alias usage and export were removed.
