# `tearleads-api-v2`

Rust API v2 service (Axum + tonic-web).

## Runtime

### Environment

- `PORT` (default `5002`)
- `ALLOWED_ORIGINS` (comma-separated CORS allowlist; empty means permissive for local dev)
- `API_V2_ENABLE_ADMIN_HARNESS` (`1|true|yes|on` to mount admin gRPC-web harness routes)

### Routes

- `GET /v2/ping`
- `POST /connect/tearleads.v2.AdminService/*` (only when `API_V2_ENABLE_ADMIN_HARNESS` is enabled)

`GET /v2/ping` response:

```json
{
  "status": "ok",
  "service": "api-v2",
  "version": "<crate-version>"
}
```

## Local Run

```bash
# default runtime (ping route)
cargo run --package tearleads-api-v2

# include admin harness connect routes
API_V2_ENABLE_ADMIN_HARNESS=1 cargo run --package tearleads-api-v2
```

## Quality Gates

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-targets --all-features
cargo llvm-cov --package tearleads-api-v2 --lib --tests --ignore-filename-regex 'main\.rs$' --fail-under-lines 100 --summary-only
```
