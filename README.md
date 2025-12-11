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

## Deployment

### App Store Connect API Key

Create an API key in App Store Connect (Users and Access → Keys):

1. Go to [App Store Connect](https://appstoreconnect.apple.com/)
2. Navigate to **Users and Access** → **Integrations** tab
3. Click `Generate API Key` to create a new API Key
4. Give it a name (e.g., "GitHub Actions")
5. Set role to **App Manager**.
6. Download the `.p8` file.
7. Note the **Key ID** and **Issuer ID**

### GitHub Personal Access Token

To create the basic authorization token:

```bash
echo -n "<github handle>:<personal access token>" | base64 | pbcopy
```

Then export it to `MATCH_GIT_BASIC_AUTHORIZATION`.
