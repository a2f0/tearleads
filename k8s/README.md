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

### 1. Provision Infrastructure

```bash
cd k8s
./scripts/init.sh
./scripts/plan.sh
./scripts/apply.sh
```

### 2. Get Kubeconfig

```bash
./scripts/kubeconfig.sh
export KUBECONFIG=~/.kube/config-k8s
kubectl get nodes
```

### 3. Set Secret Environment Variables

```bash
# Generate and export secrets
export JWT_SECRET=$(openssl rand -hex 32)
export POSTGRES_PASSWORD=$(openssl rand -hex 16)
```

### 4. Bootstrap Cluster (Ingress + Cert-Manager)

Run ansible to install nginx-ingress, cert-manager, and nerdctl/buildkit:

```bash
./ansible/scripts/run-k8s.sh
```

Or manually:

```bash
# nginx-ingress
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.10.0/deploy/static/provider/cloud/deploy.yaml

# cert-manager (for Let's Encrypt TLS)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.4/cert-manager.yaml

# Wait for cert-manager to be ready
kubectl -n cert-manager wait --for=condition=ready pod -l app.kubernetes.io/instance=cert-manager --timeout=120s
```

### 5. Build and Deploy App

```bash
./scripts/build-images.sh   # Build images on server
./scripts/deploy.sh         # Deploy to cluster
```

## DNS Records

Created automatically by Terraform:

- `k8s.yourdomain.com` - points to server IP
- `*.k8s.yourdomain.com` - wildcard for ingress routing

## Application URLs

After deployment:

- **Website**: https://k8s.yourdomain.com
- **Client**: https://app.k8s.yourdomain.com
- **API**: https://api.k8s.yourdomain.com

## Server Details

- **OS**: Ubuntu 24.04
- **Default type**: cx23 (2 vCPU, 4GB RAM)
- **K3s**: Single-node with traefik disabled

Override server type with `-var server_type=cx32` for more resources.

## Scripts

| Script | Description |
|--------|-------------|
| `init.sh` | Initialize Terraform |
| `plan.sh` | Show planned changes |
| `apply.sh` | Apply infrastructure |
| `destroy.sh` | Tear down infrastructure |
| `update.sh` | Upgrade provider versions |
| `kubeconfig.sh` | Fetch kubeconfig and write to ~/.kube/config-k8s |
| `build-images.sh` | Build container images on k3s node |
| `deploy.sh` | Deploy application to cluster |

## Manifests

| File | Description |
|------|-------------|
| `namespace.yaml` | tearleads namespace |
| `secrets.yaml` | JWT_SECRET, POSTGRES_PASSWORD |
| `configmap.yaml` | Non-sensitive configuration |
| `postgres.yaml` | PostgreSQL 16 StatefulSet + PVC |
| `redis.yaml` | Redis 7 Deployment |
| `api.yaml` | API Deployment + Service |
| `client.yaml` | Client Deployment + Service |
| `website.yaml` | Website Deployment + Service |
| `ingress.yaml` | Ingress routing rules with TLS |
| `cert-manager-issuer.yaml` | Let's Encrypt ClusterIssuer |

## Tear Down

```bash
./scripts/destroy.sh
```
