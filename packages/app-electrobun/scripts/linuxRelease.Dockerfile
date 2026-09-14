FROM oven/bun:1.4.2-debian@sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73 AS bun
FROM ubuntu:24.04@sha256:224a1869083a311ef3f13648a154ba79832fbef6364d31493642ca03082da254

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl unzip git build-essential file zstd \
    libgtk-3-0 libwebkit2gtk-4.1-0 libayatana-appindicator3-1 \
    librsvg2-bin libnss3 libasound2t64 libgbm1 xvfb xauth dbus-x11 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
WORKDIR /workspace
COPY . .
RUN chmod -R a+rX /workspace
RUN bun install --frozen-lockfile
ARG RELEASE_TIER
ARG BUILD_GIT_SHA
# The DSNs are public renderer configuration; no upload credentials enter Docker.
ARG SENTRY_ELECTROBUN_PRODUCTION_DSN
ARG SENTRY_ELECTROBUN_STAGING_DSN
RUN --mount=type=cache,id=tearleads-linux-x64-hutch,target=/root/.hutch \
    bash packages/app-electrobun/scripts/buildLinuxNative.sh "$RELEASE_TIER"
CMD ["bash"]
