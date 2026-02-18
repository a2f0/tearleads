# Production VPN Stack

This stack provisions and bootstraps the production WireGuard VPN server on
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
- Ansible dependencies installed:
  - `./ansible/scripts/setup.sh`

## Scripts

| Script | Description |
|--------|-------------|
| `scripts/init.sh` | Initialize Terraform |
| `scripts/plan.sh` | Preview infrastructure changes |
| `scripts/apply01.sh` | Step 1: Apply Terraform infrastructure changes |
| `scripts/apply02.sh` | Step 2: Wait for SSH readiness and run Ansible WireGuard bootstrap |
| `scripts/apply.sh` | Run steps 1-2 in sequence (`apply01` -> `apply02`) |
| `scripts/destroy.sh` | Destroy infrastructure |

## Quick Start

```bash
# 1. Initialize Terraform
./scripts/init.sh

# 2. Provision infrastructure
./scripts/apply01.sh

# 3. Bootstrap WireGuard with Ansible
./scripts/apply02.sh
```

Or run both steps with:

```bash
./scripts/apply.sh
```

## Create VPN Client Config

Get SSH helper output from Terraform:

```bash
terraform output -raw ssh_command
```

Create a new client profile on the server:

```bash
ssh <user>@<server-ip> "sudo wg-add-client <client-name>"
```

Retrieve the generated client config:

```bash
ssh <user>@<server-ip> "sudo cat /etc/wireguard/clients/<client-name>/<client-name>.conf" > <client-name>.conf
chmod 600 <client-name>.conf
```

## Split Tunnel Defaults

Generated client configs are split-tunnel by default. Client `AllowedIPs` includes:

- `10.100.0.0/16` (Tearleads private network)
- `10.200.0.0/24` (WireGuard client network)

This keeps normal internet traffic local and only routes Tearleads private
infrastructure through the VPN.

## Teardown

```bash
./scripts/destroy.sh
```

