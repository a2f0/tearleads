# Container Deployments

This document describes how to build, push, and deploy containers to the Kubernetes clusters.

## Overview

Container images are stored in AWS ECR (Elastic Container Registry) with separate repositories for each environment:

| Environment | Repository Prefix | Images |
|-------------|-------------------|--------|
| Staging | `tearleads-staging/` | api, client, smtp-listener, website |
| Production | `tearleads-prod/` | api, client, website |

## Prerequisites

- AWS CLI configured with appropriate credentials
- Docker installed and running
- kubectl configured for the target cluster

## Building and Pushing Containers

Use the `buildContainers.sh` script to build and push images to ECR:

```bash
# Build and push all containers for staging
./scripts/buildContainers.sh staging

# Build and push all containers for production
./scripts/buildContainers.sh prod
```

### Options

| Option | Description |
|--------|-------------|
| `--api-only` | Only build the API container |
| `--client-only` | Only build the client container |
| `--smtp-only` | Only build the SMTP listener container |
| `--website-only` | Only build the website container |
| `--no-smtp` | Skip building the SMTP listener container |
| `--no-push` | Build locally without pushing to ECR |
| `--tag TAG` | Use a specific tag (default: `latest`) |

### Examples

```bash
# Build only the API for staging
./scripts/buildContainers.sh staging --api-only

# Build all containers with a version tag
./scripts/buildContainers.sh prod --tag v1.2.3

# Build locally without pushing (for testing)
./scripts/buildContainers.sh staging --no-push
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AWS_REGION` | AWS region for ECR | `us-east-1` |
| `AWS_ACCOUNT_ID` | AWS account ID | Auto-detected |
| `VITE_API_URL` | API URL for client build | Based on environment domain |

## Setting Up ECR Authentication in Kubernetes

Before deploying, you must create an ECR registry secret in the cluster. ECR tokens expire after 12 hours, so this must be refreshed periodically.

### Manual Setup

```bash
# For staging cluster
./terraform/stacks/staging/k8s/scripts/setup-ecr-secret.sh

# For production cluster
./terraform/stacks/prod/k8s/scripts/setup-ecr-secret.sh
```

### Automated Refresh (Optional)

For production environments, consider setting up a CronJob to refresh the ECR secret automatically:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: ecr-registry-refresh
  namespace: tearleads
spec:
  schedule: "0 */6 * * *"  # Every 6 hours
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: ecr-refresh-sa
          containers:
            - name: refresh
              image: amazon/aws-cli
              command:
                - /bin/sh
                - -c
                # Replace <AWS_ACCOUNT_ID> with your account ID
                # Get your account ID: aws sts get-caller-identity --query Account --output text
                - |
                  TOKEN=$(aws ecr get-login-password --region us-east-1)
                  kubectl delete secret ecr-registry -n tearleads || true
                  kubectl create secret docker-registry ecr-registry \
                    --namespace=tearleads \
                    --docker-server=<AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com \
                    --docker-username=AWS \
                    --docker-password=$TOKEN
          restartPolicy: OnFailure
```

## Deploying to Kubernetes

After building and pushing images, deploy using kubectl:

```bash
# Apply all manifests for staging
kubectl apply -f terraform/stacks/staging/k8s/manifests/

# Or apply specific deployments
kubectl apply -f terraform/stacks/staging/k8s/manifests/api.yaml
kubectl apply -f terraform/stacks/staging/k8s/manifests/client.yaml
kubectl apply -f terraform/stacks/staging/k8s/manifests/smtp-listener.yaml
kubectl apply -f terraform/stacks/staging/k8s/manifests/website.yaml
```

### Rolling Update

To trigger a rolling update with the latest image:

```bash
kubectl rollout restart deployment/api -n tearleads
kubectl rollout restart deployment/client -n tearleads
kubectl rollout restart deployment/smtp-listener -n tearleads
kubectl rollout restart deployment/website -n tearleads
```

### Checking Deployment Status

```bash
# Watch rollout status
kubectl rollout status deployment/api -n tearleads

# Check pod status
kubectl get pods -n tearleads

# View logs
kubectl logs -f deployment/api -n tearleads
```

## Deployment Workflow

Complete deployment workflow:

```bash
# 1. Build and push containers
./scripts/buildContainers.sh staging

# 2. Ensure ECR secret is fresh (if not using CronJob)
./terraform/stacks/staging/k8s/scripts/setup-ecr-secret.sh

# 3. Apply manifests (if changed)
kubectl apply -f terraform/stacks/staging/k8s/manifests/

# 4. Trigger rolling update
kubectl rollout restart deployment/api -n tearleads
kubectl rollout restart deployment/client -n tearleads
kubectl rollout restart deployment/website -n tearleads

# 5. Verify deployment
kubectl rollout status deployment/api -n tearleads
```

## Troubleshooting

### Image Pull Errors

If pods fail with `ImagePullBackOff`:

1. Check ECR secret exists and is fresh:

   ```bash
   kubectl get secret ecr-registry -n tearleads
   ```

2. Refresh the secret:

   ```bash
   ./terraform/stacks/staging/k8s/scripts/setup-ecr-secret.sh
   ```

3. Verify image exists in ECR:

   ```bash
   aws ecr describe-images --repository-name tearleads-staging/api
   ```

### Build Failures

1. Ensure Docker is running
2. Check AWS credentials: `aws sts get-caller-identity`
3. Verify ECR login: `aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 956489103522.dkr.ecr.us-east-1.amazonaws.com`

## CI/CD Integration

Use GitHub OIDC role assumption for ECR publishing instead of long-lived AWS keys.

### Terraform-managed role outputs

From `terraform/stacks/staging/ci-artifacts`:

- `github_actions_role_arn` (staging ECR push role)

From `terraform/stacks/prod/ci-artifacts`:

- `github_actions_role_arn` (prod ECR push role)

Set repository variables in GitHub:

- `AWS_STAGING_ECR_ROLE_ARN`
- `AWS_PROD_ECR_ROLE_ARN` (when prod publish workflow is added)

Example GitHub Actions snippet:

```yaml
permissions:
  contents: read
  id-token: write

- name: Configure AWS credentials (OIDC)
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: ${{ vars.AWS_STAGING_ECR_ROLE_ARN }}
    aws-region: us-east-1

- name: Build and push
  run: ./scripts/buildContainers.sh staging --tag ${{ github.sha }}
```

Legacy IAM user outputs (`ci_access_key_id`, `ci_secret_access_key`) remain available for migration fallback.
