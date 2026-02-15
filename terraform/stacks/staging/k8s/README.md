# Staging Kubernetes Stack

This stack provisions a k3s Kubernetes cluster on Hetzner Cloud for the staging environment.

## Infrastructure

| Resource | Description |
|----------|-------------|
| Hetzner Server | Single-node k3s cluster |
| Hetzner Firewall | Ports 22, 80, 443, 6443 |
| Hetzner DNS | `k8s.{staging_domain}`, `*.k8s.{staging_domain}` |

## Prerequisites

- Hetzner Cloud API token (`TF_VAR_hcloud_token`)
- Hetzner DNS API token (`TF_VAR_hdns_token`)
- SSH key registered in Hetzner (`TF_VAR_ssh_key_name`)
- Staging domain configured (`TF_VAR_staging_domain`)

## Scripts

| Script | Description |
|--------|-------------|
| `scripts/init.sh` | Initialize Terraform |
| `scripts/plan.sh` | Preview infrastructure changes |
| `scripts/apply.sh` | Apply infrastructure changes |
| `scripts/destroy.sh` | Destroy infrastructure |
| `scripts/kubeconfig.sh` | Fetch kubeconfig from server |
| `scripts/setup-ecr-secret.sh` | Create ECR pull secret for container registry |
| `scripts/deploy.sh` | Apply all Kubernetes manifests |
| `scripts/update.sh` | Update server packages via Ansible |

## Quick Start

```bash
# 1. Initialize Terraform
./scripts/init.sh

# 2. Create the cluster
./scripts/apply.sh

# 3. Get kubeconfig
./scripts/kubeconfig.sh
export KUBECONFIG=$PWD/kubeconfig.yaml

# 4. Create namespace and secrets
kubectl apply -f manifests/namespace.yaml
kubectl apply -f manifests/secrets.yaml

# 5. Setup ECR pull secret (for container images)
./scripts/setup-ecr-secret.sh

# 6. Deploy all manifests
./scripts/deploy.sh
```

## Manifests

| Manifest | Description |
|----------|-------------|
| `namespace.yaml` | `tearleads` namespace |
| `configmap.yaml` | Application configuration |
| `secrets.yaml` | Sensitive configuration (passwords, keys) |
| `postgres.yaml` | PostgreSQL StatefulSet with PVC |
| `redis.yaml` | Redis deployment |
| `api.yaml` | API server deployment |
| `client.yaml` | Web client deployment |
| `website.yaml` | Marketing website deployment |
| `ingress.yaml` | Nginx ingress routes |
| `cert-manager-issuer.yaml` | Let's Encrypt certificate issuer |

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │         Hetzner Cloud Server            │
                    │                                         │
Internet ──────────►│  ┌─────────────────────────────────┐   │
   :80/:443         │  │           k3s Cluster            │   │
                    │  │                                  │   │
                    │  │  ┌──────────┐  ┌──────────────┐ │   │
                    │  │  │  nginx   │  │ cert-manager │ │   │
                    │  │  │ ingress  │  │              │ │   │
                    │  │  └────┬─────┘  └──────────────┘ │   │
                    │  │       │                          │   │
                    │  │  ┌────▼─────────────────────┐   │   │
                    │  │  │      tearleads namespace │   │   │
                    │  │  │                          │   │   │
                    │  │  │  ┌─────┐ ┌──────┐ ┌───┐ │   │   │
                    │  │  │  │ api │ │client│ │web│ │   │   │
                    │  │  │  └──┬──┘ └──────┘ └───┘ │   │   │
                    │  │  │     │                    │   │   │
                    │  │  │  ┌──▼───┐  ┌───────┐    │   │   │
                    │  │  │  │postgres│ │ redis │    │   │   │
                    │  │  │  │ (PVC) │  └───────┘    │   │   │
                    │  │  │  └───────┘               │   │   │
                    │  │  └──────────────────────────┘   │   │
                    │  └─────────────────────────────────┘   │
                    └─────────────────────────────────────────┘
```

## Container Images

Images are pulled from ECR. See [Container Deployments](../../../docs/container-deployments.md) for build/push workflow.

```bash
# Build and push containers
./scripts/buildContainers.sh staging

# Setup ECR pull secret (expires after 12 hours)
./scripts/setup-ecr-secret.sh

# Restart deployments to pull new images
kubectl rollout restart deployment/api deployment/client deployment/website -n tearleads
```

## Database

Staging uses an in-cluster PostgreSQL pod with a PersistentVolumeClaim for data persistence.

```bash
# Connect to PostgreSQL
kubectl exec -it statefulset/postgres -n tearleads -- psql -U tearleads -d tearleads

# View logs
kubectl logs statefulset/postgres -n tearleads
```

## Secrets

Update secrets in `manifests/secrets.yaml` (base64 encoded):

```bash
# Encode a secret
echo -n "my-secret-value" | base64

# Apply updated secrets
kubectl apply -f manifests/secrets.yaml

# Restart pods to pick up changes
kubectl rollout restart deployment/api -n tearleads
```

## Troubleshooting

### Pods not starting

```bash
# Check pod status
kubectl get pods -n tearleads

# Describe failing pod
kubectl describe pod <pod-name> -n tearleads

# Check logs
kubectl logs <pod-name> -n tearleads
```

### Image pull errors

```bash
# Refresh ECR secret
./scripts/setup-ecr-secret.sh

# Verify secret exists
kubectl get secret ecr-registry -n tearleads
```

### Certificate issues

```bash
# Check cert-manager logs
kubectl logs -n cert-manager -l app=cert-manager

# Check certificate status
kubectl get certificates -n tearleads
kubectl describe certificate <cert-name> -n tearleads
```
