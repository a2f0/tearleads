# Production VPN Stack

This stack provisions the production WireGuard VPN server infrastructure on
Hetzner.

## Infrastructure

| Resource | Description |
|----------|-------------|
| Hetzner Server | Single Ubuntu host running WireGuard |
| Hetzner Network/Subnet | Private network for internal connectivity |
| Hetzner Firewall | SSH + WireGuard UDP ingress |

## Prerequisites

- AWS credentials for Terraform state backend:
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
- Hetzner token:
  - `TF_VAR_hcloud_token`
- Hetzner SSH key name:
  - `TF_VAR_ssh_key_name`
- Server username:
  - `TF_VAR_server_username`
## Scripts

| Script | Description |
|--------|-------------|
| `scripts/init.sh` | Initialize Terraform |
| `scripts/plan.sh` | Preview infrastructure changes |
| `scripts/apply01.sh` | Step 1: Apply Terraform infrastructure changes |
| `scripts/apply02.sh` | Step 2: No-op placeholder (Ansible VPN bootstrap removed) |
| `scripts/apply.sh` | Run steps 1-2 in sequence (`apply01` -> `apply02`) |
| `scripts/destroy.sh` | Destroy infrastructure |

## Quick Start

```bash
# 1. Initialize Terraform
./scripts/init.sh

# 2. Provision infrastructure
./scripts/apply01.sh

# 3. Optional finalize step (currently no-op)
./scripts/apply02.sh
```

Or run both steps with:

```bash
./scripts/apply.sh
```

## VPN Configuration

Server provisioning is managed here; client/key bootstrap automation is no longer managed via Ansible in this repository.

## Teardown

```bash
./scripts/destroy.sh
```
