# Tearleads

## Getting Started

1. Install `mise` with `brew install mise`
2. Run `mise install`.
3. Run `source scripts/session.sh` to extend the path for scripts. Or, alternatively:
   - Add `tl() { . /path/to/checkout/session.sh; }` to `~/.zshrc`
4. Run `install-hooks.sh` to install Git hooks.
5. Run `brew install authzed/tap/spicedb authzed/tap/zed` to install SpiceDB.
6. Run `cargo run http-server` to start the API.
7. Run `bun run --filter=app dev` to start the dev server.
8. Run `spicedb serve --grpc-preshared-key "in-memory-developer-key"` to start SpiceDB.

## Running Tests

```sh
# Run all Rust tests across the workspace
cargo test

# Run tests for a specific crate
cargo test -p http-server
cargo test -p http-client

# Run a specific test by name
cargo test test_read_not_found

# Run all Bun tests across workspace packages, sequentially
bun run test

# Run Bun workspace tests through Turborepo
bun run test:turbo:bun

# Run all Turborepo test tasks
bun run test:turbo

# Run only changed/impacted Bun workspace tests through Turborepo
bun run test:turbo:affected
```

## Bun Catalogs

Shared dependency versions for workspace packages live in the root
[`package.json`](./package.json) under `catalog` and `catalogs`.
Workspace packages reference those versions with `catalog:` and
`catalog:<name>` so common versions stay aligned across the monorepo.

## Turborepo

[`turbo.json`](./turbo.json) adds dependency-aware task orchestration and
local caching on top of the Bun workspace. The `test` task depends on each
package's `build` task, so generated artifacts are refreshed before tests run.

## Building

```sh
# build the wasm client
# This will create build artifacts in `crates/http-client-wasm/pkg`
wasm-pack build crates/http-client-wasm --target web --dev

wasm-pack build crates/http-client-wasm --target web --release
```
