# Getting Started

```bash
pnpm install
pnpm dev
```

## Postgres Dev Scripts

Use these helpers if you're working on the Postgres integration locally:

- `scripts/setupPostgresDev.sh` installs and starts Postgres on macOS and prints PG* defaults (including `PGDATABASE=tearleads_development`).
- `scripts/applyPostgresSchema.ts` applies the generated Postgres schema (uses `DATABASE_URL` or PG* envs).
- `scripts/dropPostgresDb.ts` drops `tearleads_development` only (requires `--yes`).

## App Store Connect API Key

An App Store connect API key is needed for Fastlane's build automation.

1. Go to [App Store Connect](https://appstoreconnect.apple.com/)
2. Navigate to **Users and Access** → **Integrations** tab
3. Click `Generate API Key` to create a new API Key
4. Give it a name (e.g., "GitHub Actions").
5. Set role to **App Manager**.
6. Download the `.p8` file, and put it into `.secrets/`
7. Export `APP_STORE_CONNECT_KEY_ID` and `APP_STORE_CONNECT_ISSUER_ID`.
8. Use [scripts/setGithubVars.sh](../scripts/setGithubVars.sh) to deploy it to GitHub.

## GitHub Personal Access Token

A personal access token is required for Fastlane Match, which is used for signing certificate and provisioning profile management. To configure this:

1. Create a new GitHub Repository
2. Go to [Personal Access Tokens](https://github.com/settings/personal-access-tokens)
3. Give the token the following permissions:
  a. Read access to metadata
  b. Read and Write access to code
4. Encode the token with `echo -n "<github handle>:<personal access token>" | base64 | pbcopy` and set it to `MATCH_GIT_BASIC_AUTHORIZATION`
5. Use [scripts/setGithubVars.sh](../scripts/setGithubVars.sh) to set it in GitHub (for GitHub Actions).
