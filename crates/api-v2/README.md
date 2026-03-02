# `tearleads-api-v2`

Rust V2 API service (Axum), starting with `/ping`.

## Endpoints

- `GET /ping`
- `GET /v2/ping`

Both return:

```json
{
  "status": "ok",
  "service": "api-v2",
  "version": "<crate-version>"
}
```

## Quality Gates

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-targets --all-features
cargo llvm-cov --package tearleads-api-v2 --lib --tests --ignore-filename-regex 'main\.rs$' --fail-under-lines 100 --summary-only
```
