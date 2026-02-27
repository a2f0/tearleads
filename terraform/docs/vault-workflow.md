# Vault Secrets Management

This document covers how to use HashiCorp Vault for secrets management in this repository.

## Architecture

- **Server**: Hetzner Cloud VM (`vault-prod`)
- **Access**: Via Tailscale only (no public exposure)
- **Storage**: Raft (single-node) - enables snapshot backups
- **URL**: `http://vault-prod:8200`

## Quick Start

### 1. Initial Setup (First Time Only)

After provisioning the Vault server with Terraform:

```bash
# SSH to ensure server is ready
ssh vault-prod

# From your local machine, initialize Vault
cd terraform/stacks/prod/vault
./scripts/setup-vault.sh
```

This creates:

- Unseal keys at `.secrets/vault-keys.json` (back this up securely!)
- KV v2 secrets engine at `secret/`
- Environment paths: `secret/staging/env`, `secret/prod/env`
- Admin policy for full access

### 2. Authenticate

```bash
# Set Vault address
export VAULT_ADDR=http://vault-prod:8200

# Login with root token (from setup)
vault login $(jq -r '.root_token' .secrets/vault-keys.json)

# Or save token for automatic login
jq -r '.root_token' .secrets/vault-keys.json > ~/.vault-token
```

Optional: enable `userpass` auth and create a non-root user for daily file syncs:

```bash
cd terraform/stacks/prod/vault
export VAULT_ADDR=http://vault-prod:8200
export VAULT_TOKEN=$(jq -r '.root_token' .secrets/vault-keys.json)
terraform apply -var='enable_userpass_auth=true'
./scripts/create-user.sh --username alice
```

### 3. Migrate Existing Secrets

```bash
# Dry run first
./scripts/migrate-secrets.ts --dry-run

# Actually migrate
./scripts/migrate-secrets.ts
```

### 4. Store Environment Variables

```bash
# Store staging env vars
vault kv put secret/staging/env \
  DATABASE_URL="postgres://..." \
  API_KEY="sk-..." \
  OTHER_SECRET="value"

# Store prod env vars
vault kv put secret/prod/env \
  DATABASE_URL="postgres://..." \
  API_KEY="sk-..."
```

## Daily Usage

### Running Commands with Secrets

Use the wrapper script to inject Vault secrets as environment variables:

```bash
# Run terraform with staging secrets
./terraform/scripts/vault-env.sh staging terraform plan

# Run a deploy script with prod secrets
./terraform/scripts/vault-env.sh prod ./deploy.sh

# Run any command
./terraform/scripts/vault-env.sh staging env | grep DATABASE
```

### Managing Secrets

```bash
# List all secrets in an environment
vault kv list secret/staging/env

# Read a secret
vault kv get secret/staging/env

# Read specific field
vault kv get -field=DATABASE_URL secret/staging/env

# Update/add a secret (merges with existing)
vault kv patch secret/staging/env NEW_KEY="new-value"

# Replace all secrets (overwrites)
vault kv put secret/staging/env KEY1="val1" KEY2="val2"

# Delete a secret
vault kv delete secret/staging/env
```

### File-based Secrets

Files from `.secrets/` are stored at `secret/files/<filename>`:

```bash
# List all files
vault kv list secret/files

# Read a file's metadata
vault kv get secret/files/deploy.key

# Fetch all files to .secrets/ directory
cd terraform/stacks/prod/vault
./scripts/fetch-secrets.ts

# Fetch to a different directory
./scripts/fetch-secrets.ts -o /tmp/secrets

# Fetch using userpass auth instead of VAULT_TOKEN
export VAULT_USERNAME=alice
export VAULT_PASSWORD='your-password'
./scripts/fetch-secrets.ts
```

## Backup and Restore

### Creating Backups

```bash
cd terraform/stacks/prod/vault

# Create a backup (default: .secrets/vault-backups/)
./scripts/backup.sh

# Create backup to specific location
./scripts/backup.sh -o ~/vault-backup.snap
```

The backup is a single encrypted file containing all secrets.

### Restoring from Backup

```bash
# Restore from a backup file
./scripts/restore.sh -i .secrets/vault-backups/vault-snapshot-20240220.snap

# Force restore without confirmation
./scripts/restore.sh -i backup.snap --force
```

### Backup Strategy

1. **After every secret change**: Run `./scripts/backup.sh`
2. **Store backups securely**: Copy to encrypted storage, password manager, or cold storage
3. **Keep vault-keys.json**: Required to unseal after restore

## Secret Organization

```text
secret/
├── staging/
│   └── env           # Staging environment variables
├── prod/
│   └── env           # Production environment variables
└── files/
    ├── deploy.key    # SSH deploy key
    ├── AuthKey_*.p8  # Apple API key
    └── ...           # Other files from .secrets/
```

## Unsealing After Restart

If the Vault server restarts, it will be sealed:

```bash
# Check status
vault status

# Unseal with key from vault-keys.json
vault operator unseal $(jq -r '.unseal_keys_b64[0]' .secrets/vault-keys.json)
```

## Troubleshooting

### Cannot connect to Vault

```bash
# Check Tailscale is connected
tailscale status

# Check Vault server is running
ssh vault-prod "systemctl status vault"

# Check Vault is listening
ssh vault-prod "curl -s http://localhost:8200/v1/sys/health | jq"
```

### Token expired or invalid

```bash
# Re-login
vault login $(jq -r '.root_token' .secrets/vault-keys.json)
```

### Lost vault-keys.json

Without `vault-keys.json`, you cannot unseal Vault. If you have a Raft snapshot backup,
you can restore data after re-initializing, but **without a backup, all secrets are lost**.

Recovery options:

1. **With Raft snapshot**: Destroy Vault, recreate, initialize (new keys), restore snapshot
2. **Without snapshot**: Destroy Vault, recreate, re-migrate all secrets from scratch

Always keep `vault-keys.json` and Raft snapshots backed up securely in separate locations.

## Security Notes

- Vault is only accessible via Tailscale (private network)
- Root token should only be used for initial setup; consider creating limited tokens for daily use
- `vault-keys.json` contains the master key - protect it like a password
- Raft snapshots are encrypted but contain all secrets
