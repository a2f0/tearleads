# JFF

## Getting Started

Install `mise` with `brew upgrade mise`

```sh
# configure git hooks
./scripts/install-hooks.sh

# Run the server
cargo run http-server
```

## Running Tests

```sh
# Run all tests (unit + integration) across the workspace
cargo test

# Run tests for a specific crate
cargo test -p http-server
cargo test -p http-client

# Run a specific test by name
cargo test test_read_not_found

# Run WASM tests 
bun test
```

## Building

```sh
# build the wasm client
# This will create build artifacts in `http-client-wasm/pkg`
wasm-pack build http-client-wasm --target web --dev

wasm-pack build http-client-wasm --target web --release
```
