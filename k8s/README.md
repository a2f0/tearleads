# K8s Infrastructure (Hetzner Cloud)

Single-node k3s cluster on Hetzner Cloud for testing and development.

## Prerequisites

- Terraform CLI installed
- Hetzner Cloud account with API token
- SSH key registered in Hetzner Cloud
- Domain managed by Hetzner DNS

## Required Environment Variables

```bash
export TF_CLOUD_ORGANIZATION="your-org"
export TF_WORKSPACE_K8S="your-k8s-workspace"
export TF_VAR_hcloud_token="your-hetzner-api-token"
export TF_VAR_ssh_key_name="your-ssh-key-name"
export TF_VAR_domain="yourdomain.com"
export TF_VAR_server_username="deploy"
```

## Quick Start

```bash
cd k8s
./scripts/init.sh
./scripts/plan.sh
./scripts/apply.sh
```

## Retrieve Kubeconfig

```bash
./scripts/kubeconfig.sh > ~/.kube/config-k8s
export KUBECONFIG=~/.kube/config-k8s
kubectl get nodes
```

## DNS Records

The following DNS records are created automatically:

- `k8s.yourdomain.com` - points to server IP
- `*.k8s.yourdomain.com` - wildcard for ingress routing

## Server Details

- **OS**: Ubuntu 24.04
- **Default type**: cx23 (2 vCPU, 4GB RAM)
- **K3s**: Installed via cloud-init with traefik disabled

Override server type with `-var server_type=cx22` for more resources.

## Scripts

| Script | Description |
|--------|-------------|
| `init.sh` | Initialize Terraform |
| `plan.sh` | Show planned changes |
| `apply.sh` | Apply infrastructure |
| `destroy.sh` | Tear down infrastructure |
| `update.sh` | Upgrade provider versions |
| `kubeconfig.sh` | Retrieve kubeconfig from server |

## Tear Down

```bash
./scripts/destroy.sh
```
