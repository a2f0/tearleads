# Disaster Recovery Technical Control Map (NIST SP 800-53)

This map ties disaster recovery and container deployment controls to concrete implementation and evidence per NIST SP 800-53 requirements.

## Sentinel Controls

| Sentinel | Description | NIST Controls | Implementation Evidence |
| --- | --- | --- | --- |
| `TL-CR-001` | ECR container registries with AES-256 encryption | SC-28, SC-13 | `terraform/modules/aws-ci-artifacts/main.tf` |
| `TL-CR-002` | ECR scan-on-push for vulnerability detection | RA-5, SI-3 | `terraform/modules/aws-ci-artifacts/main.tf` |
| `TL-CR-003` | K8s registry authentication with rotating ECR tokens | IA-5, AC-2 | `terraform/stacks/*/k8s/scripts/setup-ecr-secret.sh` |
| `TL-CR-004` | ECR lifecycle policies for image retention | MP-6 | `terraform/modules/aws-ci-artifacts/main.tf` |
| `TL-DR-001` | Per-stack S3 backend with unique state keys | CP-9 | `terraform/stacks/*/versions.tf` |
| `TL-DR-002` | DynamoDB state locking for concurrent access | CP-9 | `terraform/bootstrap/main.tf` |
| `TL-DR-003` | Documented container build/push/deploy workflow | CP-10, IR-4 | `terraform/docs/container-deployments.md` |

## NIST Control Family Mapping

### CP - Contingency Planning

- **CP-9**: Information System Backup - S3 state backends (`TL-DR-001`) and state locking (`TL-DR-002`).
- **CP-10**: Information System Recovery and Reconstitution - Recovery workflows for containerized applications (`TL-DR-003`).

### SC - System and Communications Protection

- **SC-28**: Protection of Information at Rest - ECR repository encryption (`TL-CR-001`).
- **SC-13**: Cryptographic Protection - AES-256 encryption for container images.

### RA - Risk Assessment / SI - System and Information Integrity

- **RA-5**: Vulnerability Monitoring and Scanning - ECR scan-on-push (`TL-CR-002`).
- **SI-3**: Malicious Code Protection - Automatic scanning prevents deployment of compromised images.

### IA - Identification and Authentication / AC - Access Control

- **IA-5**: Authenticator Management - Rotating ECR tokens for cluster access (`TL-CR-003`).
- **AC-2**: Account Management - Managed identities and ECR pull secrets.

### MP - Media Protection

- **MP-6**: Media Sanitization - ECR lifecycle policies ensure old "media" (images) are disposed of per retention requirements (`TL-CR-004`).
