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
npm install
npm run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Run API and client in parallel |
| `npm run dev:api` | Run API only |
| `npm run dev:client` | Run client only |
| `npm run build` | Build all packages |
| `npm run build:shared` | Build shared package |
| `npm run clean` | Clean build artifacts |

## License

Unlicensed
