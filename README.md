# JFF

## Getting Started

```sh
# Run the server
cargo run http-server
```

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
