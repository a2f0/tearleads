# Production K8s Scripts

Operational scripts for the production Kubernetes cluster.

## Provisioning Pipeline

These scripts run the full cluster provisioning in four ordered steps. Run them individually or use `apply.sh` to execute all four in sequence.

| Script | Step | Description |
|--------|------|-------------|
| `apply01-terraform.sh` | 1 | Terraform init and apply (Hetzner server, firewall, DNS, Cloudflare tunnel) |
| `apply02-bootstrap-cluster.sh` | 2 | Fetch kubeconfig, wait for node readiness, run Ansible baseline, create namespace, setup ECR secret, deploy manifests, and start cloudflared |
| `apply03-build-images.sh` | 3 | Build and push all production container images to ECR |
| `apply04-rollout-containers.sh` | 4 | Restart deployments to pull latest images, run database migrations, and execute smoke tests |
| `apply.sh` | 1-4 | Orchestrates all four steps in sequence with timing |

## Terraform Lifecycle

| Script | Description |
|--------|-------------|
| `init.sh` | Initialize Terraform backend and validate environment variables |
| `plan.sh` | Preview infrastructure changes |
| `destroy.sh` | Tear down the production cluster (10s confirmation delay) and clean up |
| `unlock.sh` | Force-unlock Terraform state by lock ID |
| `update.sh` | Re-initialize Terraform with `-upgrade` to update providers |

## Kubernetes Operations

| Script | Description |
|--------|-------------|
| `kubeconfig.sh` | Fetch kubeconfig from the k3s server via SSH and save locally |
| `deploy.sh` | Render and apply all Kubernetes manifests (secrets, configmaps, services, ingress) |
| `rollout.sh` | Restart deployments, wait for rollout, run migrations and smoke tests |
| `build.sh` | Build and push production container images to ECR |
| `migrate.sh` | Run database migrations via the API pod CLI |
| `setup-ecr-secret.sh` | Create or refresh the ECR docker-registry pull secret (expires after 12h) |
| `vfs-crdt-compaction.sh` | Manage VFS CRDT compaction CronJob (status, enable/disable, suspend/resume, run-once, logs) |

## Smoke Tests

These scripts run smoke tests against the production cluster. Run them individually or use `smoke.sh` to execute both in sequence.

| Script | Step | Description |
|--------|------|-------------|
| `smoke01-postgres.sh` | 1 | RDS TCP connectivity and SQL query via API pod |
| `smoke02-api.sh` | 2 | DNS resolution, in-cluster and external API/v2 health, client baked-in URL check |
| `smoke.sh` | 1-2 | Orchestrates both smoke tests in sequence with timing |

## Debugging

| Script | Description |
|--------|-------------|
| `makeAdmin.sh` | Promote a user to admin by email |
| `dump-api-env.sh` | Inspect API pod environment (names only by default, `--show-values` for full output) |
| `logs-api.sh` | Tail API pod logs (follows by default) |
