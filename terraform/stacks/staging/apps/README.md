# Staging Kubernetes Applications

This Terraform stack manages the core Helm charts and applications running on the staging Kubernetes cluster.

## Architecture

- **Ingress Controller:** NGINX Ingress Controller
- **Certificate Management:** cert-manager (Let's Encrypt)
- **Secrets Management:** HashiCorp Vault

## Prerequisites

1.  **Kubernetes Cluster:** The infrastructure stack (`../k8s`) must be applied first.
2.  **Kubeconfig:** You must have a valid kubeconfig file locally.
    ```bash
    # Run this from the repository root
    ./terraform/stacks/staging/k8s/scripts/kubeconfig.sh
    ```

## Usage

1.  Initialize Terraform:
    ```bash
    terraform init
    ```

2.  Review the plan:
    ```bash
    terraform plan
    ```

3.  Apply the changes:
    ```bash
    terraform apply
    ```

## Secrets

Vault is deployed in "standalone" mode for simplicity in staging.
