# Build stage
FROM node:22-slim AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Copy all workspace package.json files that client depends on
COPY packages/admin/package.json packages/admin/
COPY packages/audio/package.json packages/audio/
COPY packages/businesses/package.json packages/businesses/
COPY packages/calendar/package.json packages/calendar/
COPY packages/camera/package.json packages/camera/
COPY packages/classic/package.json packages/classic/
COPY packages/client/package.json packages/client/
COPY packages/compliance/package.json packages/compliance/
COPY packages/console/package.json packages/console/
COPY packages/contacts/package.json packages/contacts/
COPY packages/db/package.json packages/db/
COPY packages/db-test-utils/package.json packages/db-test-utils/
COPY packages/email/package.json packages/email/
COPY packages/health/package.json packages/health/
COPY packages/help/package.json packages/help/
COPY packages/keychain/package.json packages/keychain/
COPY packages/mls-chat/package.json packages/mls-chat/
COPY packages/msw/package.json packages/msw/
COPY packages/notes/package.json packages/notes/
COPY packages/notifications/package.json packages/notifications/
COPY packages/search/package.json packages/search/
COPY packages/settings/package.json packages/settings/
COPY packages/shared/package.json packages/shared/
COPY packages/sync/package.json packages/sync/
COPY packages/terminal/package.json packages/terminal/
COPY packages/ui/package.json packages/ui/
COPY packages/vehicles/package.json packages/vehicles/
COPY packages/vfs-explorer/package.json packages/vfs-explorer/
COPY packages/wallet/package.json packages/wallet/
COPY packages/window-manager/package.json packages/window-manager/

# Install dependencies (skip postinstall - source not copied yet)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source code for all workspace packages
COPY packages/admin packages/admin
COPY packages/audio packages/audio
COPY packages/businesses packages/businesses
COPY packages/calendar packages/calendar
COPY packages/camera packages/camera
COPY packages/classic packages/classic
COPY packages/client packages/client
COPY packages/compliance packages/compliance
COPY packages/console packages/console
COPY packages/contacts packages/contacts
COPY packages/db packages/db
COPY packages/db-test-utils packages/db-test-utils
COPY packages/email packages/email
COPY packages/health packages/health
COPY packages/help packages/help
COPY packages/keychain packages/keychain
COPY packages/mls-chat packages/mls-chat
COPY packages/msw packages/msw
COPY packages/notes packages/notes
COPY packages/notifications packages/notifications
COPY packages/search packages/search
COPY packages/settings packages/settings
COPY packages/shared packages/shared
COPY packages/sync packages/sync
COPY packages/terminal packages/terminal
COPY packages/ui packages/ui
COPY packages/vehicles packages/vehicles
COPY packages/vfs-explorer packages/vfs-explorer
COPY packages/wallet packages/wallet
COPY packages/window-manager packages/window-manager

# Copy docs directory (used by help system)
COPY docs docs

# Build shared packages first (dependencies must be built before client)
RUN pnpm --filter @tearleads/shared build && \
    pnpm --filter @tearleads/db build && \
    pnpm --filter @tearleads/ui build && \
    pnpm --filter @tearleads/notifications build && \
    pnpm --filter @tearleads/search build

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
