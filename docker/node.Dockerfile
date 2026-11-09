# syntax=docker/dockerfile:1

# Room-coordination node only. Unlike docker/Dockerfile this image has no
# frontend bundle, no music library, no ML stack, and no volumes: singers keep
# their own tracks, the node only holds room state in memory.

FROM rust:1-bookworm AS builder

WORKDIR /build

# The whole workspace is copied so `cargo build -p nightingale-node` can resolve
# every member manifest. Only the node crate gets compiled.
COPY . .

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/target \
    cargo build --release --locked -p nightingale-node \
    && cp target/release/nightingale-node /usr/local/bin/nightingale-node

FROM debian:bookworm-slim AS runtime

RUN useradd --system --create-home --shell /usr/sbin/nologin nightingale

COPY --from=builder /usr/local/bin/nightingale-node /usr/local/bin/nightingale-node

ENV NIGHTINGALE_BIND=0.0.0.0:8080

USER nightingale
EXPOSE 8080

ENTRYPOINT ["nightingale-node"]
