# Staging K8s Scripts

Operational scripts for the staging Kubernetes cluster.

## Provisioning Pipeline

These scripts run the full cluster provisioning in four ordered steps. Run them individually or use `apply.sh` to execute all four in sequence.

| Script | Step | Description |
|--------|------|-------------|
| `apply01-terraform.sh` | 1 | Terraform init and apply (Hetzner server, firewall, DNS, Cloudflare tunnel) |
| `apply02-bootstrap-cluster.sh` | 2 | Fetch kubeconfig, sync GitHub secrets, wait for node readiness, run Ansible baseline, create namespace, setup ECR secret, deploy manifests, and start cloudflared |
| `apply03-build-images.sh` | 3 | Build and push all staging container images to ECR |
| `apply04-rollout-containers.sh` | 4 | Restart deployments to pull latest images, run database migrations, and execute smoke tests |
| `apply.sh` | 1-4 | Orchestrates all four steps in sequence with timing |

## Terraform Lifecycle

| Script | Description |
|--------|-------------|
| `init.sh` | Initialize Terraform backend and validate environment variables |
| `plan.sh` | Preview infrastructure changes |
| `destroy.sh` | Tear down the staging cluster (5s confirmation delay) and clean up GitHub secrets |
| `unlock.sh` | Force-unlock Terraform state by lock ID |
| `update.sh` | Re-initialize Terraform with `-upgrade` to update providers |

## Kubernetes Operations

| Script | Description |
|--------|-------------|
| `kubeconfig.sh` | Fetch kubeconfig from the k3s server via SSH and save locally |
| `deploy.sh` | Render and apply all Kubernetes manifests (secrets, configmaps, services, ingress) |
| `rollout.sh` | Restart deployments, wait for rollout, run migrations and smoke tests |
| `build.sh` | Build and push staging container images to ECR |
| `migrate.sh` | Run database migrations via the API pod CLI |
| `reset.sh` | Reset staging data: flush Redis, empty S3 bucket, drop/recreate Postgres DB, re-run migrations. Requires `--yes` flag |
| `setup-ecr-secret.sh` | Create or refresh the ECR docker-registry pull secret (expires after 12h) |
| `vfs-crdt-compaction.sh` | Manage VFS CRDT compaction CronJob (status, enable/disable, suspend/resume, run-once, logs) |

## Smoke Tests

| Script | Description |
|--------|-------------|
| `smoke-api.sh` | DNS resolution, in-cluster and external API/v2 health, client baked-in URL check |
| `smoke-postgres.sh` | Postgres local query and API-to-Postgres TCP connectivity |
| `smoke-replica.sh` | Postgres replica query, replication status, and API-to-replica TCP connectivity |
| `smoke-s3.sh` | Garage S3 put/get/delete round-trip (in-cluster with local fallback) |
| `smoke-smtp.sh` | SMTP TCP connectivity and end-to-end send/verify via VFS storage |

## Test Data and Debugging

| Script | Description |
|--------|-------------|
| `createTestUsers.sh` | Create test user accounts via the API CLI |
| `createBobAndAlice.sh` | Run migrations, set up Bob's notes share, and make Bob an admin |
| `makeAdmin.sh` | Promote a user to admin by email |
| `dump-api-env.sh` | Inspect API pod environment (names only by default, `--show-values` for full output) |
| `logs-api.sh` | Tail API pod logs (follows by default) |

## Utilities

| Script | Description |
|--------|-------------|
| `cleanup-tailscale-device.sh` | Remove a Tailscale device by hostname |
| `s3-helpers.sh` | Shared helper functions for S3/Garage secret decoding and validation (sourced by other scripts) |
