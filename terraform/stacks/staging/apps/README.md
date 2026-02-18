# Staging Kubernetes Applications

This Terraform stack manages the core Helm charts and applications running on the staging Kubernetes cluster.

## Architecture

- **Ingress Controller:** NGINX Ingress Controller
- **Certificate Management:** cert-manager (Let's Encrypt)
- **Secrets Management:** HashiCorp Vault
- **Logging:** Grafana k8s-monitoring (Alloy -> Loki)

## Prerequisites

1. **Kubernetes Cluster:** The infrastructure stack (`../k8s`) must be applied first.
2. **Kubeconfig:** You must have a valid kubeconfig file locally.

    ```bash
    # Run this from the repository root
    ./terraform/stacks/staging/k8s/scripts/kubeconfig.sh
    ```

## Usage

1. Initialize Terraform:

    ```bash
    terraform init
    ```

2. Review the plan:

    ```bash
    terraform plan
    ```

3. Apply the changes:

    ```bash
    terraform apply
    ```

## Logging Configuration

Logging is configured via Terraform variables for Grafana Cloud Loki:

- `TF_VAR_loki_url` (base URL or full push endpoint)
- `TF_VAR_loki_username` (Loki tenant/user ID)
- `TF_VAR_loki_api_token` (Grafana Cloud access policy token)

Example:

```bash
export TF_VAR_loki_username="<LOKI_TENANT_ID>"
export TF_VAR_loki_api_token="<token>"
export TF_VAR_loki_url="https://<LOKI_URL_ENDPOINT>"
```

## Secrets

Vault is deployed in "standalone" mode for simplicity in staging.
