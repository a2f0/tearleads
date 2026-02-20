# Build stage
FROM node:22-slim AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/website/package.json packages/website/
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/

# Install dependencies (skip postinstall - source not copied yet)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source code
COPY packages/website packages/website
COPY packages/api packages/api
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY packages/ui packages/ui

# Copy docs directory (used by website docs pages)
COPY docs docs

# Install Playwright browsers for Mermaid rendering
RUN npm install -g playwright && playwright install chromium --with-deps

# Build dependencies and generate OpenAPI spec for /docs page
RUN pnpm --filter @tearleads/shared build && \
    pnpm --filter @tearleads/db build && \
    pnpm --filter @tearleads/api buildOpenapi && \
    pnpm --filter @tearleads/website build

# Production stage - nginx
FROM nginx:alpine

# Copy built static files
COPY --from=builder /app/packages/website/dist /usr/share/nginx/html

# Ensure static files are world-readable for nginx worker user.
RUN find /usr/share/nginx/html -type d -exec chmod 755 {} + && \
    find /usr/share/nginx/html -type f -exec chmod 644 {} +

# Copy nginx config
RUN echo 'server { \
    listen 80; \
    server_name _; \
    root /usr/share/nginx/html; \
    index index.html; \
    absolute_redirect off; \
    location / { \
        try_files $uri $uri/index.html =404; \
    } \
    location /_astro/ { \
        expires 1y; \
        add_header Cache-Control "public, immutable"; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
