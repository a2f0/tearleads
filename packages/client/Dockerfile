# Build stage
FROM node:22-slim AS builder

WORKDIR /app

# Install pnpm and build dependencies
RUN apt-get update && apt-get install -y curl unzip git && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Copy all workspace packages so new package dependencies are picked up automatically.
COPY packages packages
COPY proto proto

# Install dependencies (skip postinstall - source not copied yet)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy scripts needed for setup
COPY scripts/downloadSqliteWasm.sh scripts/

# Download SQLite WASM files (gitignored, must be downloaded)
RUN scripts/downloadSqliteWasm.sh

# Build shared package so app-builder can import @tearleads/shared dist output in clean CI checkouts.
RUN pnpm --filter @tearleads/shared build

# Generate app config/theme assets required by client CSS imports.
ARG APP_NAME=tearleads
RUN cd packages/app-builder && pnpm exec tsx src/cli.ts generate --app "${APP_NAME}"

# Build all client dependencies with build scripts.
RUN pnpm --filter @tearleads/client^... --if-present build

# Build client (VITE_API_URL must be set at build time)
# Use tsconfig.docker.json to exclude test files from type checking
COPY docs docs
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN cd packages/client && pnpm tsc -p tsconfig.docker.json && DOTENV_CONFIG_QUIET=true pnpm vite build

# Production stage - nginx
FROM nginx:alpine

# Copy built static files
COPY --from=builder /app/packages/client/dist /usr/share/nginx/html

# Ensure static files are world-readable for nginx worker user.
RUN find /usr/share/nginx/html -type d -exec chmod 755 {} \; && \
    find /usr/share/nginx/html -type f -exec chmod 644 {} \;

# Copy nginx config for SPA routing and sqlite wasm/static handling.
RUN echo 'server { \
    listen 80; \
    root /usr/share/nginx/html; \
    index index.html; \
    default_type application/octet-stream; \
    types { \
        application/javascript js mjs; \
        application/wasm wasm; \
        text/css css; \
        text/html html; \
        application/json json; \
        image/svg+xml svg; \
    } \
    location = /sw.js { \
        try_files $uri =404; \
        add_header Cache-Control "no-cache, no-store, must-revalidate"; \
    } \
    location ~* ^/(manifest\\.webmanifest|registerSW\\.js)$ { \
        try_files $uri =404; \
        add_header Cache-Control "no-cache"; \
    } \
    location = /sqlite { \
        try_files /index.html =404; \
        add_header Cache-Control "no-cache"; \
    } \
    location ~* ^/sqlite/.*\\.(wasm|js)$ { \
        try_files $uri =404; \
        add_header Cache-Control "public, immutable"; \
    } \
    location ^~ /assets/ { \
        try_files $uri =404; \
        expires 1y; \
        add_header Cache-Control "public, immutable"; \
    } \
    location / { \
        try_files $uri $uri/ /index.html; \
        add_header Cache-Control "no-cache"; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
