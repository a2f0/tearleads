FROM rust:1.94.0-slim AS builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY proto proto

RUN cargo build --release --package tearleads-api-v2

FROM debian:trixie-slim

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
