# OSP Suite — React client, Rust server, PostgreSQL production image.
FROM node:24-bookworm-slim AS client-builder
WORKDIR /build
COPY package.json package-lock.json ./
COPY modules ./modules
COPY verticals ./verticals
COPY client ./client
COPY tools ./tools
COPY platform/server/public/app ./platform/server/public/app
RUN npm ci && npm run build

FROM rust:1.89-bookworm AS builder

WORKDIR /build
COPY server/Cargo.toml server/Cargo.lock server/
COPY server/src server/src
RUN cargo build --manifest-path server/Cargo.toml --release --no-default-features

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server
COPY --from=builder /build/server/target/release/osp-server /usr/local/bin/osp-server
COPY definitions /app/definitions
COPY --from=client-builder /build/client-dist /app/client-dist

ENV OSP_ENV=production \
    OSP_PORT=3000 \
    OSP_DEMO=0 \
    OSP_SIGNUP=0 \
    OSP_DEFS=/app/definitions \
    OSP_PUBLIC=/app/client-dist \
    OSP_JOBS_INTERVAL_SEC=60

RUN useradd --system --create-home --uid 10001 osp \
    && chown -R osp:osp /app
USER osp

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/osp-server"]
