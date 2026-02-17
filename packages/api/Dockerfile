# Build stage
FROM node:22-slim AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/sync/package.json packages/sync/

# Install dependencies (skip postinstall - source not copied yet)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source code
COPY packages/api packages/api
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY packages/sync packages/sync

# Build shared packages first, then API bundle
RUN pnpm --filter @tearleads/shared build && \
    pnpm --filter @tearleads/db build && \
    pnpm --filter @tearleads/api build:bundle

# Production stage
FROM node:22-slim

WORKDIR /app

# Copy only the bundled output
COPY --from=builder /app/packages/api/dist/server.cjs ./server.cjs

ENV NODE_ENV=production
ENV PORT=5001

EXPOSE 5001

CMD ["node", "server.cjs"]
