# Disaster Recovery Technical Control Map

This map ties disaster recovery and container deployment controls to concrete implementation and test evidence.

## Sentinel Controls

| Sentinel | Description | Implementation Evidence | Test Evidence |
| --- | --- | --- | --- |
| `TL-CR-001` | ECR container registries with AES-256 encryption | [`terraform/modules/aws-ci-artifacts/main.tf`](../../../terraform/modules/aws-ci-artifacts/main.tf) | `aws ecr describe-repositories --query 'repositories[*].{name:repositoryName,encryption:encryptionConfiguration}'` |
| `TL-CR-002` | ECR scan-on-push for vulnerability detection | [`terraform/modules/aws-ci-artifacts/main.tf`](../../../terraform/modules/aws-ci-artifacts/main.tf) | `aws ecr describe-repositories --query 'repositories[*].imageScanningConfiguration'` |
| `TL-CR-003` | K8s registry authentication with rotating ECR tokens | `terraform/stacks/*/k8s/scripts/setup-ecr-secret.sh` | `kubectl get secret ecr-registry -n tearleads -o jsonpath='{.type}'` |
| `TL-CR-004` | ECR lifecycle policies for image retention | [`terraform/modules/aws-ci-artifacts/main.tf`](../../../terraform/modules/aws-ci-artifacts/main.tf) | `for repo in api client website; do aws ecr get-lifecycle-policy --repository-name "tearleads-<env>/$repo"; done` |
| `TL-DR-001` | Per-stack S3 backend with unique state keys | `terraform/stacks/*/versions.tf` | `grep -r 'key.*=' terraform/stacks/*/versions.tf` |
| `TL-DR-002` | DynamoDB state locking for concurrent access | [`terraform/bootstrap/main.tf`](../../../terraform/bootstrap/main.tf) | `aws dynamodb describe-table --table-name tearleads-terraform-locks` |
| `TL-DR-003` | Documented container build/push/deploy workflow | [`terraform/docs/container-deployments.md`](../../../terraform/docs/container-deployments.md) | `./scripts/buildContainers.sh staging --no-push` |

## Control Details

### TL-CR-001: Container Registry

**Implementation Files:**

- `terraform/modules/aws-ci-artifacts/main.tf` - ECR repository resources
- `terraform/stacks/staging/ci-artifacts/main.tf` - Staging ECR configuration
- `terraform/stacks/prod/ci-artifacts/main.tf` - Production ECR configuration

**Key Configuration:**

- `encryption_configuration.encryption_type = "AES256"` - Server-side encryption
- `image_tag_mutability = "MUTABLE"` - Allow tag updates for latest
- Environment-separated repositories (staging vs prod prefixes)

**Repositories:**

- `tearleads-staging/api`, `tearleads-staging/client`, `tearleads-staging/website`
- `tearleads-prod/api`, `tearleads-prod/client`, `tearleads-prod/website`

### TL-CR-002: Container Image Scanning

**Implementation Files:**

- `terraform/modules/aws-ci-artifacts/main.tf` - ECR scanning configuration

**Key Configuration:**

- `image_scanning_configuration.scan_on_push = true` - Automatic vulnerability scanning
- Scans run on every image push
- Results available via `aws ecr describe-image-scan-findings`

### TL-CR-003: Container Pull Secrets

**Implementation Files:**

- `terraform/stacks/staging/k8s/scripts/setup-ecr-secret.sh` - Staging secret setup
- `terraform/stacks/prod/k8s/scripts/setup-ecr-secret.sh` - Production secret setup
- `terraform/stacks/*/k8s/manifests/*.yaml` - K8s deployment manifests

**Key Configuration:**

- ECR tokens obtained via `aws ecr get-login-password`
- K8s `docker-registry` secret type
- `imagePullSecrets` configured on all deployments
- Tokens expire after 12 hours (manual refresh or CronJob)

### TL-CR-004: Container Lifecycle

**Implementation Files:**

- `terraform/modules/aws-ci-artifacts/main.tf` - ECR lifecycle policy

**Key Configuration:**

- `ecr_lifecycle_max_images = 20` (staging) / `50` (prod)
- Automatic cleanup of images exceeding retention limit
- Prevents unbounded storage growth

### TL-DR-001: State Isolation

**Implementation Files:**

- `terraform/stacks/*/versions.tf` - Per-stack backend configuration

**Key Configuration:**

- S3 backend with unique `key` per stack
- Format: `stacks/<environment>/<stack>/terraform.tfstate`
- Prevents state collisions between stacks
- Enables independent stack lifecycle management

### TL-DR-002: State Locking

**Implementation Files:**

- `terraform/bootstrap/main.tf` - DynamoDB table creation

**Key Configuration:**

- DynamoDB table `tearleads-terraform-locks`
- `LockID` hash key for mutual exclusion
- Prevents concurrent modifications
- Automatic lock release on completion

### TL-DR-003: Container Recovery

**Implementation Files:**

- `terraform/docs/container-deployments.md` - Recovery documentation
- `scripts/buildContainers.sh` - Build and push script

**Recovery Workflow:**

1. Build containers: `./scripts/buildContainers.sh <env>`
2. Setup ECR secret: `./terraform/stacks/<env>/k8s/scripts/setup-ecr-secret.sh`
3. Apply manifests: `kubectl apply -f terraform/stacks/<env>/k8s/manifests/`
4. Restart deployments: `kubectl rollout restart deployment/<name> -n tearleads`

**Recovery Time Objective (RTO):**

- Container rebuild: ~5-10 minutes
- ECR push: ~2-5 minutes
- K8s deployment: ~1-2 minutes
- Total: ~10-20 minutes

## SOC2 Control Mapping

| Sentinel | TSC Control | Rationale |
| --- | --- | --- |
| `TL-CR-001` | CC6.1 | Logical access controls for container registry |
| `TL-CR-002` | CC7.1 | Vulnerability detection on container push |
| `TL-CR-003` | CC6.2 | Registry authentication and authorization |
| `TL-CR-004` | CC6.5 | Container image disposal and lifecycle |
| `TL-DR-001` | CC9.1, A1.2 | Business disruption mitigation via state isolation |
| `TL-DR-002` | CC9.1, A1.2 | State protection via locking |
| `TL-DR-003` | A1.2, A1.3 | Recovery procedures and testing |

## Notes

- Container registries are separated by environment to prevent cross-environment access
- ECR credentials use the same IAM user as S3 CI artifacts
- Recovery procedures should be tested quarterly per A1.3 requirements
- Container scan results should be reviewed as part of CC7.1 security monitoring
