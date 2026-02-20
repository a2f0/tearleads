# Network Subnet Map

This map documents the private IPv4 ranges currently defined in Terraform stack defaults.

> Note: values can be overridden by `TF_VAR_*` at apply time.

## CIDR allocation summary

| Environment | Stack | Network | Subnet | Purpose | Source |
|---|---|---|---|---|---|
| staging | `stacks/staging/tee` | `10.42.0.0/16` | `10.42.1.0/24` | Azure Confidential VM (TEE) network | `terraform/stacks/staging/tee/variables.tf` |
| prod | `stacks/prod/tee` | `10.43.0.0/16` | `10.43.1.0/24` | Azure Confidential VM (TEE) network | `terraform/stacks/prod/tee/variables.tf` |

## Visual map

```text
10.42.0.0/16   staging-tee-vnet
└── 10.42.1.0/24   staging-tee-subnet

10.43.0.0/16   prod-tee-vnet
└── 10.43.1.0/24   prod-tee-subnet
```

## Tailscale overlay network

Tailscale provides a secure overlay network for internal service access. IPs are assigned from the `100.x.x.x` CGNAT range by Tailscale.

| Stack | Hostname | Access Groups | Ports | Purpose |
|---|---|---|---|---|
| `stacks/prod/vault` | `vault-prod` | `group:prod-access` | 22 (SSH), 8200 (Vault) | HashiCorp Vault secrets management |
| `stacks/staging/vault` | `vault-staging` | `group:staging-access` | 22 (SSH), 8200 (Vault) | Staging Vault (when deployed) |

**ACL Configuration**: `terraform/stacks/shared/tailscale/main.tf`

Access groups:

- `group:staging-access` - Members can access `tag:staging-vault` devices
- `group:prod-access` - Members can access `tag:prod-vault` devices

## Reserved / externally managed networking

The following stacks use provider-managed or externally selected networking and do not currently define private subnet CIDRs in Terraform defaults:

- `terraform/stacks/staging/k8s`
- `terraform/stacks/prod/k8s`
- `terraform/stacks/prod/rds`
- `terraform/stacks/prod/vault` - Uses Tailscale overlay (see above)
