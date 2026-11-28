# Build from the repo root:  docker build -f crates/cord-server/Dockerfile -t cord-server crates
FROM rust:1-bookworm AS build
WORKDIR /src
COPY cord-core cord-core
COPY cord-server cord-server
RUN cargo build --release --manifest-path cord-server/Cargo.toml

FROM debian:bookworm-slim
RUN useradd --system --home /data cord && mkdir /data && chown cord /data
COPY --from=build /src/cord-server/target/release/cord-server /usr/local/bin/cord-server
USER cord
VOLUME /data
EXPOSE 8787
ENTRYPOINT ["cord-server"]
CMD ["serve", "--data", "/data", "--addr", "0.0.0.0:8787"]
