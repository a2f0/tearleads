# Infrastructure Technical Controls

This document maps infrastructure compliance sentinels to their implementations across Terraform and Ansible configurations.

## Sentinel Index

| Sentinel | Control | Location | Description |
| --- | --- | --- | --- |
| `TL-INFRA-001` | SSH Key Authentication | `terraform/main.tf` | SSH key-only authentication via Hetzner SSH key reference |
| `TL-INFRA-002` | Server Hardening | `terraform/main.tf` | Cloud-init hardening: root disabled, non-root user, SSH key-only |
| `TL-INFRA-003` | Managed Identity | `tee/iam.tf` | User-assigned managed identity for credential-less Azure auth |
| `TL-INFRA-004` | SSH Hardening | `ansible/playbooks/templates/sshd_config.j2` | Comprehensive SSH hardening (root disabled, key-only, modern ciphers, rate limiting) |
| `TL-NET-001` | Network Security Group | `tee/network.tf` | NSG with default deny and explicit allow rules |
| `TL-NET-002` | SSH Access Restriction | `tee/network.tf` | SSH limited to `allowed_ssh_cidr` variable |
| `TL-NET-003` | Host Firewall | `ansible/playbooks/main.yml` | UFW firewall with default deny incoming |
| `TL-NET-004` | Infrastructure Firewall | `terraform/main.tf` | Hetzner Cloud firewall with explicit port rules |
| `TL-CRYPTO-001` | Key Vault RBAC | `tee/kms.tf` | Azure Key Vault with RBAC, purge protection, Premium SKU |
| `TL-CRYPTO-002` | VM Secrets Access | `tee/kms.tf` | Least-privilege Key Vault Secrets User role for VM |
| `TL-CRYPTO-003` | Attestation Key | `tee/kms.tf` | RSA 2048-bit key for TEE attestation workflows |
| `TL-CRYPTO-004` | Confidential VM | `tee/compute.tf` | Azure CVM with vTPM, Secure Boot, AMD SEV-SNP |
| `TL-CRYPTO-005` | Key Vault Protection | `tee/versions.tf` | Disable purge on destroy, enable soft delete recovery |
| `TL-KERN-001` | Kernel Hardening | `ansible/playbooks/templates/99-security-hardening.conf.j2` | Sysctl security parameters (ASLR, network hardening, ptrace restrictions) |
| `TL-AUTH-001` | Brute-Force Protection | `ansible/playbooks/templates/fail2ban-sshd.conf.j2` | Fail2ban SSH jail with progressive bans |
| `TL-SVC-001` | API Service Sandboxing | `ansible/playbooks/templates/tearleads-api.service.j2` | Systemd hardening (namespaces, syscall filters, capabilities) |
| `TL-SVC-002` | SMTP Service Sandboxing | `ansible/playbooks/templates/tearleads-smtp-listener.service.j2` | Systemd hardening with CAP_NET_BIND_SERVICE |
| `TL-CR-001` | Container Registry | `terraform/modules/aws-ci-artifacts/main.tf` | ECR repositories with encryption, scan-on-push, lifecycle policies |
| `TL-CR-002` | Container Image Scanning | `terraform/modules/aws-ci-artifacts/main.tf` | ECR scan-on-push for vulnerability detection |
| `TL-CR-003` | Container Pull Secrets | `terraform/stacks/*/k8s/scripts/setup-ecr-secret.sh` | K8s registry authentication with rotating ECR tokens |
| `TL-CR-004` | Container Lifecycle | `terraform/modules/aws-ci-artifacts/main.tf` | ECR lifecycle policies for image retention and cleanup |
| `TL-DR-001` | State Isolation | `terraform/stacks/*/terraform.tf` | Per-stack S3 backend with unique state keys |
| `TL-DR-002` | State Locking | `terraform/stacks/bootstrap/main.tf` | DynamoDB state locking for concurrent access protection |
| `TL-DR-003` | Container Recovery | `terraform/docs/container-deployments.md` | Documented build/push/deploy workflow for rapid recovery |

## Framework Mapping

These controls support the following framework requirements:

### SOC2 Trust Services Criteria

| Sentinel | TSC Controls | Rationale |
| --- | --- | --- |
| `TL-INFRA-001`, `TL-INFRA-002`, `TL-INFRA-004` | CC6.1, CC6.6 | Logical access controls, protection from external threats |
| `TL-NET-001`, `TL-NET-002`, `TL-NET-003`, `TL-NET-004` | CC6.1, CC6.6 | Network isolation and access restriction (NSG, UFW, Hetzner firewall) |
| `TL-CRYPTO-001`, `TL-CRYPTO-002`, `TL-CRYPTO-005` | CC6.1, CC6.7 | Cryptographic key management, purge protection |
| `TL-CRYPTO-003`, `TL-CRYPTO-004` | CC6.1, CC6.7 | Hardware-based encryption and attestation |
| `TL-INFRA-003` | CC6.1, CC6.2 | Identity management without stored credentials |
| `TL-KERN-001` | CC6.1 | Kernel hardening prevents privilege escalation |
| `TL-AUTH-001` | CC6.1 | Brute-force protection for authentication |
| `TL-SVC-001`, `TL-SVC-002` | CC6.1 | Service isolation via systemd sandboxing |
| `TL-CR-001`, `TL-CR-003` | CC6.1, CC6.2 | Container registry access control and authentication |
| `TL-CR-002` | CC7.1 | Container vulnerability scanning on push |
| `TL-CR-004` | CC6.5 | Container image lifecycle and disposal |
| `TL-DR-001`, `TL-DR-002` | CC9.1, A1.2 | Infrastructure state protection and recovery |
| `TL-DR-003` | A1.2, A1.3 | Container deployment recovery procedures |

### NIST SP 800-53

| Sentinel | NIST Controls | Rationale |
| --- | --- | --- |
| `TL-INFRA-001`, `TL-INFRA-002`, `TL-INFRA-004` | AC-17, IA-2, IA-5 | Remote access, identification, authenticator management |
| `TL-NET-001`, `TL-NET-002`, `TL-NET-003`, `TL-NET-004` | SC-7, AC-4 | Boundary protection, information flow enforcement |
| `TL-CRYPTO-001`, `TL-CRYPTO-002`, `TL-CRYPTO-003`, `TL-CRYPTO-005` | SC-12, SC-13 | Cryptographic key establishment, protection |
| `TL-CRYPTO-004` | SC-28, SI-7 | Protection of information at rest, software integrity |
| `TL-INFRA-003` | IA-2, IA-5 | Identification, authenticator management |
| `TL-KERN-001` | SC-5, SI-16 | Denial of service protection, memory protection |
| `TL-AUTH-001` | AC-7 | Unsuccessful logon attempts handling |
| `TL-SVC-001`, `TL-SVC-002` | SC-7, AC-6 | Boundary protection, least privilege |
| `TL-CR-001`, `TL-CR-003` | AC-2, IA-5 | Container registry account management, authenticator management |
| `TL-CR-002` | RA-5, SI-3 | Container vulnerability scanning, malicious code protection |
| `TL-CR-004` | MP-6 | Container image media sanitization |
| `TL-DR-001`, `TL-DR-002` | CP-9, CP-10 | Infrastructure state backup and recovery |
| `TL-DR-003` | CP-10, IR-4 | Container deployment recovery, incident handling |

### HIPAA Security Rule

| Sentinel | HIPAA Standard | Rationale |
| --- | --- | --- |
| `TL-INFRA-001`, `TL-INFRA-002`, `TL-INFRA-004` | 164.312(d) | Person or entity authentication |
| `TL-NET-001`, `TL-NET-002`, `TL-NET-003`, `TL-NET-004` | 164.312(e)(1) | Transmission security |
| `TL-CRYPTO-001`, `TL-CRYPTO-002`, `TL-CRYPTO-003`, `TL-CRYPTO-005` | 164.312(a)(2)(iv) | Encryption and decryption |
| `TL-CRYPTO-004` | 164.312(a)(2)(iv), 164.312(e)(2)(ii) | Encryption mechanism |
| `TL-AUTH-001` | 164.312(d) | Person or entity authentication |
| `TL-SVC-001`, `TL-SVC-002` | 164.312(a)(1) | Access control |
| `TL-CR-001`, `TL-CR-003` | 164.312(a)(1), 164.312(d) | Container registry access control, authentication |
| `TL-CR-002` | 164.308(a)(1)(ii)(D) | Container security scanning (information system activity review) |
| `TL-DR-001`, `TL-DR-002`, `TL-DR-003` | 164.308(a)(7)(ii)(A), 164.308(a)(7)(ii)(B) | Disaster recovery plan, data backup plan |

## Evidence Collection

### Terraform State

Infrastructure compliance can be verified via Terraform state inspection:

```bash
# Verify server hardening configuration
terraform show -json | jq '.values.root_module.resources[] | select(.type == "hcloud_server")'

# Verify Hetzner firewall rules (TL-NET-004)
terraform show -json | jq '.values.root_module.resources[] | select(.type == "hcloud_firewall") | .values.rule'

# Verify Key Vault RBAC and purge protection (TL-CRYPTO-001)
terraform show -json | jq '.values.root_module.resources[] | select(.type == "azurerm_key_vault") | {rbac: .values.rbac_authorization_enabled, purge_protection: .values.purge_protection_enabled, sku: .values.sku_name}'

# Verify confidential VM settings (TL-CRYPTO-004)
terraform show -json | jq '.values.root_module.resources[] | select(.type == "azurerm_linux_virtual_machine") | {vtpm: .values.vtpm_enabled, secure_boot: .values.secure_boot_enabled}'
```

### Ansible Playbook Evidence

Server configuration compliance can be verified by running configuration checks:

```bash
# Verify SSH hardening (TL-INFRA-004)
ssh user@host 'grep -E "^(PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|MaxAuthTries)" /etc/ssh/sshd_config'

# Verify UFW firewall status (TL-NET-003)
ssh user@host 'sudo ufw status verbose'

# Verify kernel hardening (TL-KERN-001)
ssh user@host 'sysctl net.ipv4.conf.all.rp_filter kernel.randomize_va_space kernel.kptr_restrict'

# Verify fail2ban status (TL-AUTH-001)
ssh user@host 'sudo fail2ban-client status sshd'

# Verify systemd service hardening (TL-SVC-001, TL-SVC-002)
ssh user@host 'systemctl show tearleads-api --property=NoNewPrivileges,ProtectSystem,PrivateDevices,RestrictNamespaces'

# Verify journald retention
ssh user@host 'cat /etc/systemd/journald.conf.d/compliance.conf'
```

### Container Registry Evidence

ECR container registry compliance can be verified via AWS CLI and Terraform.
Replace `<env>` with `staging` or `prod` as appropriate:

```bash
# Verify ECR repositories exist with encryption (TL-CR-001)
# For staging:
aws ecr describe-repositories --repository-names tearleads-staging/api tearleads-staging/client tearleads-staging/website
# For prod:
aws ecr describe-repositories --repository-names tearleads-prod/api tearleads-prod/client tearleads-prod/website

# Verify scan-on-push is enabled for all repos (TL-CR-002)
aws ecr describe-repositories --query 'repositories[*].{name:repositoryName,scanOnPush:imageScanningConfiguration.scanOnPush}'

# Verify lifecycle policies exist for all repos (TL-CR-004)
for repo in api client website; do
  aws ecr get-lifecycle-policy --repository-name "tearleads-<env>/$repo" 2>/dev/null && echo "OK: $repo" || echo "MISSING: $repo"
done

# Verify K8s ECR secret exists (TL-CR-003)
kubectl get secret ecr-registry -n tearleads -o jsonpath='{.type}'
```

### Disaster Recovery Evidence

Infrastructure state and recovery procedures can be verified:

```bash
# Verify S3 state bucket exists with versioning (TL-DR-001)
aws s3api get-bucket-versioning --bucket tearleads-terraform-state

# Verify DynamoDB lock table exists (TL-DR-002)
aws dynamodb describe-table --table-name tearleads-terraform-locks --query 'Table.{name:TableName,status:TableStatus}'

# Verify state isolation - each stack has unique key
grep -r "key.*=" terraform/stacks/*/terraform.tf

# Container recovery procedure test (TL-DR-003)
./scripts/buildContainers.sh staging --no-push  # Verify build works
./terraform/stacks/staging/k8s/scripts/setup-ecr-secret.sh  # Verify auth works
```
