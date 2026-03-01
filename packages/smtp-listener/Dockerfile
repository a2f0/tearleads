# Build stage
FROM node:22-slim AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/smtp-listener/package.json packages/smtp-listener/
COPY packages/shared/package.json packages/shared/

# Install dependencies (skip postinstall - source not copied yet)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source code
COPY proto proto
COPY packages/smtp-listener packages/smtp-listener
COPY packages/shared packages/shared

# Build bundle for runtime
RUN pnpm --filter @tearleads/shared build && \
    pnpm --filter @tearleads/smtp-listener build:bundle

# Production stage
FROM node:22-slim

WORKDIR /app

# Copy bundled output
COPY --from=builder /app/packages/smtp-listener/dist/server.cjs ./server.cjs

ENV NODE_ENV=production
ENV SMTP_HOST=0.0.0.0
ENV SMTP_PORT=25
ENV REDIS_URL=redis://redis:6379

EXPOSE 25

CMD ["node", "server.cjs"]
