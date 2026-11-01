# syntax=docker/dockerfile:1
FROM rust:1.91-bookworm AS build
ARG TARGETARCH
ARG TARGETVARIANT
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
# Recheck application sources even when a checkout restores older timestamps.
# Export the binary outside the cache mount so it is available to the runtime stage.
RUN --mount=type=cache,id=tee-trade-cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=tee-trade-cargo-git,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,id=tee-trade-target-rust-1.91-${TARGETARCH}${TARGETVARIANT},target=/app/target,sharing=locked \
    find src -type f -exec touch {} + && \
    cargo build --release --locked && \
    cp target/release/tee-trade-api /app/tee-trade-api

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/tee-trade-api /usr/local/bin/tee-trade-api
USER 10001:10001
EXPOSE 8080
CMD ["tee-trade-api"]
