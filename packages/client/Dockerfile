# Build stage
FROM node:22-slim AS builder

WORKDIR /app

# Install pnpm and build dependencies
RUN apt-get update && apt-get install -y curl unzip && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Copy all workspace packages so new package dependencies are picked up automatically.
COPY packages packages

# Install dependencies (skip postinstall - source not copied yet)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy docs directory (used by help system)
COPY docs docs

# Copy scripts needed for setup
COPY scripts/downloadSqliteWasm.sh scripts/

# Download SQLite WASM files (gitignored, must be downloaded)
RUN scripts/downloadSqliteWasm.sh

# Build all client dependencies with build scripts.
RUN pnpm --filter @tearleads/client^... --if-present build

# Build client (VITE_API_URL must be set at build time)
# Use tsconfig.docker.json to exclude test files from type checking
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN cd packages/client && pnpm tsc -p tsconfig.docker.json && DOTENV_CONFIG_QUIET=true pnpm vite build

# Production stage - nginx
FROM nginx:alpine

# Copy built static files
COPY --from=builder /app/packages/client/dist /usr/share/nginx/html

# Copy nginx config for SPA routing
RUN echo 'server { \
    listen 80; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
    location /assets/ { \
        expires 1y; \
        add_header Cache-Control "public, immutable"; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
