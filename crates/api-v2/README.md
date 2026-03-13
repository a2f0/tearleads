# `tearleads-api-v2`

Rust API v2 service (Axum + tonic-web).

## Runtime

### Environment

- `PORT` (default `5002`)
- `ALLOWED_ORIGINS` (comma-separated CORS allowlist; empty means permissive for local dev)
- `API_V2_ENABLE_ADMIN_HARNESS` (`1|true|yes|on` to force static fixture repositories)
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE` (admin Postgres gateway wiring)
- `REDIS_URL` (admin Redis gateway wiring)
- `API_V2_CONNECT_UPSTREAM_URL` (default `http://api:5001/v1/connect`; upstream used for non-admin `/connect` passthrough)

### Routes

- `GET /v2/ping`
- `POST /connect/tearleads.v2.AdminService/*` (always mounted)
- `POST /connect/*` for non-admin v2 services (proxied upstream via `API_V2_CONNECT_UPSTREAM_URL`)

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
# default runtime (Postgres + Redis repository wiring from env, with non-admin connect passthrough)
cargo run --package tearleads-api-v2

# force static fixture repositories for admin routes
API_V2_ENABLE_ADMIN_HARNESS=1 cargo run --package tearleads-api-v2
```

## Quality Gates

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-targets --all-features
cargo llvm-cov --package tearleads-api-v2 --lib --tests --ignore-filename-regex '(main\.rs|postgres_gateway/)' --fail-under-lines 100 --summary-only
```
