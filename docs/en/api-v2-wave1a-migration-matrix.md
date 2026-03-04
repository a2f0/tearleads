# API v2 Wave 1A Migration Matrix

This matrix tracks the first DAL-proving admin read endpoints selected for v2 migration in issue #2555.

| Endpoint | Value | Dependency | Blast | Auth | Payload | Owner | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `AdminService.GetPostgresInfo` | 2 | 2 | 1 | 4 | 1 | @a2f0 | Contracts + traits + adapters + hardened handler wiring landed |
| `AdminService.GetTables` | 3 | 2 | 2 | 4 | 1 | @a2f0 | Contracts + traits + adapters + hardened handler wiring landed |
| `AdminService.GetColumns` | 3 | 2 | 2 | 4 | 1 | @a2f0 | Contracts + traits + adapters + hardened handler wiring landed |
| `AdminService.GetRedisKeys` | 3 | 2 | 2 | 4 | 1 | @a2f0 | Contracts + traits + adapters + hardened handler wiring landed |
| `AdminService.GetRedisValue` | 3 | 2 | 2 | 4 | 1 | @a2f0 | Contracts + traits + adapters + hardened handler wiring landed |

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
- `api.admin` Wave 1A read methods now route through `api.adminV2` (`GetPostgresInfo`, `GetTables`, `GetColumns`, `GetRedisKeys`, `GetRedisValue`).
- Next slice: migrate additional admin read/write operations off `tearleads.v1.AdminService` after v2 contracts/handlers are implemented.
