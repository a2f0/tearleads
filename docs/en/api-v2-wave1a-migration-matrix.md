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
- Next slice: cut over Wave 1A admin consumers from v1 connect JSON routes to `api.adminV2` calls.
