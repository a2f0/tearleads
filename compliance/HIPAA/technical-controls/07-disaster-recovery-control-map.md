# Disaster Recovery Technical Control Map (HIPAA)

This map ties disaster recovery and container deployment controls to HIPAA Security Rule requirements and implementation evidence.

## Sentinel Controls

| Sentinel | Description | HIPAA Standard | Implementation Evidence |
| --- | --- | --- | --- |
| `TL-CR-001` | ECR container registries with AES-256 encryption | 164.312(a)(2)(iv) | [`terraform/modules/aws-ci-artifacts/main.tf`](../../../terraform/modules/aws-ci-artifacts/main.tf) |
| `TL-CR-002` | ECR scan-on-push for vulnerability detection | 164.308(a)(1)(ii)(D) | [`terraform/modules/aws-ci-artifacts/main.tf`](../../../terraform/modules/aws-ci-artifacts/main.tf) |
| `TL-CR-003` | K8s registry authentication with rotating ECR tokens | 164.312(d) | `terraform/stacks/*/k8s/scripts/setup-ecr-secret.sh` |
| `TL-CR-004` | ECR lifecycle policies for image retention | 164.310(d)(2)(i) | [`terraform/modules/aws-ci-artifacts/main.tf`](../../../terraform/modules/aws-ci-artifacts/main.tf) |
| `TL-DR-001` | Per-stack S3 backend with unique state keys | 164.308(a)(7)(ii)(A) | `terraform/stacks/*/versions.tf` |
| `TL-DR-002` | DynamoDB state locking for concurrent access | 164.308(a)(7)(ii)(A) | [`terraform/bootstrap/main.tf`](../../../terraform/bootstrap/main.tf) |
| `TL-DR-003` | Documented container build/push/deploy workflow | 164.308(a)(7)(ii)(B) | [`terraform/docs/container-deployments.md`](../../../terraform/docs/container-deployments.md) |

## HIPAA Standard Mapping

### 164.308(a)(7)(ii)(A) - Data Backup Plan

- Establish and implement procedures to create and maintain retrievable exact copies of ePHI. Infrastructure state isolation and locking ensure backup integrity (`TL-DR-001`, `TL-DR-002`).

### 164.308(a)(7)(ii)(B) - Disaster Recovery Plan

- Establish (and implement as needed) procedures to restore any loss of data. Documented container recovery workflows provide rapid restoration capabilities (`TL-DR-003`).

### 164.312(a)(2)(iv) - Encryption and Decryption

- Implement a mechanism to encrypt and decrypt ePHI. ECR repositories enforce AES-256 encryption for all images (`TL-CR-001`).

### 164.308(a)(1)(ii)(D) - Information System Activity Review

- Implement procedures to regularly review records of information system activity. ECR scan-on-push provides automated vulnerability reviews for containerized workloads (`TL-CR-002`).

### 164.312(d) - Person or Entity Authentication

- Implement procedures to verify that a person or entity seeking access to ePHI is the one claimed. Cluster authentication via rotating ECR tokens ensures only authorized workloads are deployed (`TL-CR-003`).

### 164.310(d)(2)(i) - Disposal

- Implement policies and procedures to address the final disposition of ePHI. ECR lifecycle policies automate the disposal of old container images (`TL-CR-004`).
