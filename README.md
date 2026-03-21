# JFF

## Getting Started

1. Run the server with `cargo run -p server`
2. Run the client with `cargo run -p client`

## Running Tests

```sh
# Run all tests (unit + integration) across the workspace
cargo test

# Run tests for a specific crate
cargo test -p server
cargo test -p client

# Run a specific test by name
cargo test test_accept_one
```
