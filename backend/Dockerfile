FROM rust:1.91-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/release/tee-trade-api /usr/local/bin/tee-trade-api
USER 10001:10001
EXPOSE 8080
CMD ["tee-trade-api"]
