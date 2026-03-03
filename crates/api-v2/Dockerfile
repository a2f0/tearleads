FROM rust:1.93.1-slim AS builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY crates/api-v2/Cargo.toml crates/api-v2/Cargo.toml
COPY crates/api-v2/src crates/api-v2/src
COPY crates/api-v2-ping-wasm/Cargo.toml crates/api-v2-ping-wasm/Cargo.toml
COPY crates/api-v2-ping-wasm/src crates/api-v2-ping-wasm/src

RUN cargo build --release --package tearleads-api-v2

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 app

WORKDIR /app

COPY --from=builder /app/target/release/tearleads-api-v2 /usr/local/bin/tearleads-api-v2

USER app

ENV PORT=5002
EXPOSE 5002

ENTRYPOINT ["/usr/local/bin/tearleads-api-v2"]
