# Rapid

A TypeScript monorepo with an Express API and React client.

## Structure

```
packages/
├── shared/   # Shared types and utilities
├── api/      # Express API (port 5001)
└── client/   # React client (port 3000)
```

## Getting Started

```bash
pnpm install
pnpm dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run API and client in parallel |
| `pnpm dev:api` | Run API only |
| `pnpm dev:client` | Run client only |
| `pnpm build` | Build all packages |
| `pnpm build:shared` | Build shared package |
| `pnpm clean` | Clean build artifacts |

## License

Unlicensed
