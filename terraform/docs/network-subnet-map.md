# Network Subnet Map

This map documents the private IPv4 ranges currently defined in Terraform stack defaults.

> Note: values can be overridden by `TF_VAR_*` at apply time.

## CIDR allocation summary

| Environment | Stack | Network | Subnet | Purpose | Source |
|---|---|---|---|---|---|
| staging | `stacks/staging/tee` | `10.42.0.0/16` | `10.42.1.0/24` | Azure Confidential VM (TEE) network | `terraform/stacks/staging/tee/variables.tf` |
| prod | `stacks/prod/tee` | `10.43.0.0/16` | `10.43.1.0/24` | Azure Confidential VM (TEE) network | `terraform/stacks/prod/tee/variables.tf` |
| prod | `stacks/prod/vpn` | `10.100.0.0/16` | `10.100.1.0/24` | Hetzner private network for VPN server | `terraform/stacks/prod/vpn/variables.tf` |
| prod | `stacks/prod/vpn` | `10.200.0.0/24` | n/a | WireGuard client address pool | `terraform/stacks/prod/vpn/variables.tf` |

## Visual map

```text
10.42.0.0/16   staging-tee-vnet
└── 10.42.1.0/24   staging-tee-subnet

10.43.0.0/16   prod-tee-vnet
└── 10.43.1.0/24   prod-tee-subnet

10.100.0.0/16  prod-vpn-network
└── 10.100.1.0/24  prod-vpn-subnet

10.200.0.0/24  prod-wireguard-clients
```

## Reserved / externally managed networking

The following stacks use provider-managed or externally selected networking and do not currently define private subnet CIDRs in Terraform defaults:

- `terraform/stacks/staging/k8s`
- `terraform/stacks/prod/k8s`
- `terraform/stacks/prod/rds`
- `terraform/stacks/prod/vault`
