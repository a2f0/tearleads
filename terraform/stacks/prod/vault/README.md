# Vault Stack (Production)

This stack provisions the HashiCorp Vault server on Hetzner Cloud.

## Architecture

- **Infrastructure**: Terraform (this stack)
- **Configuration**: Ansible (`ansible/playbooks/vault.yml`)
- **Access**: Tailscale only (no public exposure)

## Provisioning Workflow

### 1. Create/Update Infrastructure

```bash
cd terraform/stacks/prod/vault
./scripts/init.sh
./scripts/apply.sh
```

### 2. Configure Vault with Ansible

**Do not configure Vault in cloud-init or Terraform.** Use Ansible:

```bash
./ansible/scripts/run-vault-prod.sh
```

This configures:
- Raft storage backend
- Vault listener (port 8200)
- Security hardening
- UFW firewall rules

### 3. Initialize Vault (First Time Only)

After Ansible configures Vault:

```bash
cd terraform/stacks/prod/vault
./scripts/setup-vault.sh
```

This creates unseal keys at `.secrets/vault-keys.json`.

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/init.sh` | Initialize Terraform |
| `scripts/plan.sh` | Plan infrastructure changes |
| `scripts/apply.sh` | Apply infrastructure changes |
| `scripts/destroy.sh` | Destroy infrastructure |
| `scripts/setup-vault.sh` | Initialize and unseal Vault |
| `scripts/backup.sh` | Create Raft snapshot backup |
| `scripts/restore.sh` | Restore from Raft snapshot |
| `scripts/migrate-secrets.sh` | Migrate `.secrets/` files to Vault |
| `scripts/fetch-secrets.sh` | Fetch secrets from Vault to `.secrets/` |

## Configuration Management

| Concern | Managed By | Location |
|---------|------------|----------|
| Server provisioning | Terraform | `main.tf` |
| SSH keys, Tailscale | cloud-init | `main.tf` (user_data) |
| Vault config | Ansible | `ansible/playbooks/vault.yml` |
| Vault secrets | Vault CLI | `scripts/setup-vault.sh` |

**Why Ansible for Vault config?**
- Idempotent: can rerun to update config
- Version controlled: changes are visible in git
- No reprovision required: update config without destroying server

## Documentation

- Full workflow guide: `terraform/docs/vault-workflow.md`
- Ansible playbook: `ansible/playbooks/vault.yml`
