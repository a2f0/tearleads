# Staging Kubernetes Stack

This stack provisions a k3s Kubernetes cluster on Hetzner Cloud for the staging environment.

## Infrastructure

| Resource | Description |
|----------|-------------|
| Hetzner Server | Single-node k3s cluster |
| Hetzner Firewall | Ports 22, 80, 443, 6443 |
| Cloudflare DNS | `k8s.{staging_domain}`, `app.k8s.{staging_domain}`, `api.k8s.{staging_domain}` |
| Cloudflare Tunnel | Secure ingress routing through `cloudflared` |

## Prerequisites

- Hetzner Cloud API token (`TF_VAR_hcloud_token`)
- SSH key registered in Hetzner (`TF_VAR_ssh_key_name`)
- Staging domain configured (`TF_VAR_staging_domain`)
- Cloudflare API token (`TF_VAR_cloudflare_api_token`)
- Cloudflare account ID (`TF_VAR_cloudflare_account_id`)

> For backwards compatibility with scripts (like the Ansible playbook) that still reference `TF_VAR_STAGING_DOMAIN`, setting the uppercase alias to the same value is still supported. The canonical names are the lowercase `TF_VAR_*` variants listed above.

## Scripts

| Script | Description |
|--------|-------------|
| `scripts/init.sh` | Initialize Terraform |
| `scripts/plan.sh` | Preview infrastructure changes |
| `scripts/apply01.sh` | Step 1: Apply Terraform infrastructure changes |
| `scripts/apply02.sh` | Step 2: Fetch kubeconfig, run Ansible baseline bootstrap, and deploy manifests |
| `scripts/apply03.sh` | Step 3: Build/push staging images and roll deployments |
| `scripts/apply.sh` | Run steps 1-3 in sequence (`apply01` → `apply02` → `apply03`) |
| `scripts/destroy.sh` | Destroy infrastructure |
| `scripts/kubeconfig.sh` | Fetch kubeconfig from server |
| `scripts/setup-ecr-secret.sh` | Create ECR pull secret for container registry |
| `scripts/deploy.sh` | Apply all Kubernetes manifests |
| `scripts/update.sh` | Update server packages via Ansible |
| `scripts/smoke-s3.sh` | Verify Garage-backed S3 storage with in-cluster put/get/delete |

## Quick Start

```bash
# 1. Initialize Terraform
./scripts/init.sh

# 2. Create the cluster infrastructure
./scripts/apply01.sh

# 3. Run baseline bootstrap (Ansible) and deploy manifests
./scripts/apply02.sh

# 4. Build/push images and rollout app deployments
./scripts/apply03.sh
```

### Cloudflare Zone

This stack manages `staging_domain` as a Cloudflare zone resource and outputs
`cloudflare_zone_nameservers`. Update registrar NS delegation to those values
after the first apply.

The zone uses `prevent_destroy`, so `terraform destroy` will not remove it.

## Manifests

| Manifest | Description |
|----------|-------------|
| `namespace.yaml` | `tearleads` namespace |
| `configmap.yaml` | Application configuration |
| `secrets.yaml` | Sensitive configuration (passwords, keys) |
| `postgres.yaml` | PostgreSQL StatefulSet with PVC |
| `redis.yaml` | Redis deployment |
| `garage.yaml` | Garage S3-compatible object storage for VFS blobs |
| `api.yaml` | API server deployment |
| `client.yaml` | Web client deployment |
| `website.yaml` | Marketing website deployment |
| `cloudflared.yaml` | Cloudflare Tunnel connector deployment |
| `ingress.yaml` | Nginx ingress routes |
| `cert-manager-issuer.yaml` | Let's Encrypt certificate issuer |

### Kustomize Scaffold

A kustomize scaffold exists at:

- `manifests/kustomize/base`
- `manifests/kustomize/overlays/staging`

Default deploy behavior is unchanged. `scripts/deploy.sh` still applies raw
manifests directly unless you opt in with:

```bash
USE_KUSTOMIZE=true ./scripts/deploy.sh
```

With `USE_KUSTOMIZE=true`, core resources are applied via:

- `manifests/kustomize/overlays/staging`

`manifests/secrets.yaml` is still applied directly by `scripts/deploy.sh`
(outside kustomize) to avoid placeholder expansion pitfalls.

Ingress and cert issuer are still rendered from templates at runtime.

## Architecture

```text
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
                    │  │  │  ┌──▼───┐ ┌─────┐ ┌────┐│   │   │
                    │  │  │  │postgres│redis││garage││   │   │
                    │  │  │  │ (PVC) │└─────┘│(PVC)││   │   │
                    │  │  │  └───────┘       └─────┘│   │   │
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

## Object Storage (Garage)

Staging uses [Garage](https://garagehq.deuxfleurs.fr/) for S3-compatible object storage, backing the VFS blob persistence layer. Garage is a lightweight, distributed storage system written in Rust.

### Configuration

| Environment Variable | Value | Description |
|---------------------|-------|-------------|
| `VFS_BLOB_S3_ENDPOINT` | `http://garage:3900` | Garage S3 API endpoint |
| `VFS_BLOB_S3_BUCKET` | `vfs-blobs` | Bucket for VFS blob data |
| `VFS_BLOB_S3_REGION` | `us-east-1` | Region (required by SDK) |
| `VFS_BLOB_S3_FORCE_PATH_STYLE` | `true` | Use path-style URLs |

### Garage Secrets

| Secret | Description |
|--------|-------------|
| `GARAGE_RPC_SECRET` | Inter-node RPC authentication |
| `GARAGE_ADMIN_TOKEN` | Admin API authentication |
| `VFS_BLOB_S3_ACCESS_KEY_ID` | S3 access key for API |
| `VFS_BLOB_S3_SECRET_ACCESS_KEY` | S3 secret key for API |

Generate secrets:

```bash
GARAGE_RPC_SECRET=$(openssl rand -hex 32)
GARAGE_ADMIN_TOKEN=$(openssl rand -hex 32)
VFS_BLOB_S3_ACCESS_KEY_ID=$(openssl rand -hex 16)
VFS_BLOB_S3_SECRET_ACCESS_KEY=$(openssl rand -hex 32)
```

### Initial Setup

The `garage-setup` Job runs automatically on first deploy to:

1. Configure the storage layout (assign capacity to node)
2. Import S3 credentials
3. Create the `vfs-blobs` bucket
4. Grant read/write/owner permissions

### Commands

```bash
# Check Garage status
kubectl logs deployment/garage -n tearleads

# Check setup job
kubectl logs job/garage-setup -n tearleads

# Exec into Garage pod for CLI access
kubectl exec -it deployment/garage -n tearleads -- garage -c /etc/garage.toml status

# List buckets
kubectl exec -it deployment/garage -n tearleads -- garage -c /etc/garage.toml bucket list

# Check bucket info
kubectl exec -it deployment/garage -n tearleads -- garage -c /etc/garage.toml bucket info vfs-blobs
```

### Smoke Test (Recommended)

Run the end-to-end S3 smoke test against staging (uses live in-cluster secret
credentials and performs put/get/delete):

```bash
./scripts/smoke-s3.sh
```

Optional overrides:

```bash
NAMESPACE=tearleads \
S3_BUCKET=vfs-blobs \
S3_ENDPOINT=http://garage:3900 \
./scripts/smoke-s3.sh
```

Notes:

- By default, the script does not fail if `garage-setup` is still running; set `REQUIRE_SETUP_JOB_COMPLETE=true` to enforce completion.
- If the in-cluster smoke pod image cannot be pulled, the script automatically falls back to local `aws` CLI + `kubectl port-forward`.

### Re-running Setup

If you need to re-run the setup job (e.g., after changing credentials):

```bash
# Delete the old job
kubectl delete job garage-setup -n tearleads

# Re-apply the manifest
kubectl apply -f manifests/garage.yaml
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

### Garage / Object storage issues

```bash
# Check Garage pod status
kubectl get pods -n tearleads -l app=garage

# Check Garage logs
kubectl logs deployment/garage -n tearleads

# Check setup job logs
kubectl logs job/garage-setup -n tearleads

# Verify Garage health
kubectl exec -it deployment/garage -n tearleads -- wget -qO- http://localhost:3903/health

# Check storage layout
kubectl exec -it deployment/garage -n tearleads -- garage -c /etc/garage.toml layout show

# List keys
kubectl exec -it deployment/garage -n tearleads -- garage -c /etc/garage.toml key list
```
