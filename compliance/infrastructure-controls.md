# Infrastructure Technical Controls

This document maps infrastructure compliance sentinels to their implementations across Terraform and Ansible configurations.

## Sentinel Index

| Sentinel | Control | Location | Description |
| --- | --- | --- | --- |
| `TL-INFRA-001` | SSH Key Authentication | `terraform/main.tf` | SSH key-only authentication via Hetzner SSH key reference |
| `TL-INFRA-002` | Server Hardening | `terraform/main.tf` | Cloud-init hardening: root disabled, non-root user, SSH key-only |
| `TL-INFRA-003` | Managed Identity | `tee/iam.tf` | User-assigned managed identity for credential-less Azure auth |
| `TL-INFRA-004` | SSH Root Disabled | `ansible/playbooks/main.yml` | SSH `PermitRootLogin no` enforcement |
| `TL-NET-001` | Network Security Group | `tee/network.tf` | NSG with default deny and explicit allow rules |
| `TL-NET-002` | SSH Access Restriction | `tee/network.tf` | SSH limited to `allowed_ssh_cidr` variable |
| `TL-CRYPTO-001` | Key Vault RBAC | `tee/kms.tf` | Azure Key Vault with RBAC authorization enabled |
| `TL-CRYPTO-002` | VM Secrets Access | `tee/kms.tf` | Least-privilege Key Vault Secrets User role for VM |
| `TL-CRYPTO-003` | Attestation Key | `tee/kms.tf` | RSA 2048-bit key for TEE attestation workflows |
| `TL-CRYPTO-004` | Confidential VM | `tee/compute.tf` | Azure CVM with vTPM, Secure Boot, AMD SEV-SNP |

## Framework Mapping

These controls support the following framework requirements:

### SOC2 Trust Services Criteria

| Sentinel | TSC Controls | Rationale |
| --- | --- | --- |
| `TL-INFRA-001`, `TL-INFRA-002`, `TL-INFRA-004` | CC6.1, CC6.6 | Logical access controls, protection from external threats |
| `TL-NET-001`, `TL-NET-002` | CC6.1, CC6.6 | Network isolation and access restriction |
| `TL-CRYPTO-001`, `TL-CRYPTO-002` | CC6.1, CC6.7 | Cryptographic key management, transmission controls |
| `TL-CRYPTO-003`, `TL-CRYPTO-004` | CC6.1, CC6.7 | Hardware-based encryption and attestation |
| `TL-INFRA-003` | CC6.1, CC6.2 | Identity management without stored credentials |

### NIST SP 800-53

| Sentinel | NIST Controls | Rationale |
| --- | --- | --- |
| `TL-INFRA-001`, `TL-INFRA-002`, `TL-INFRA-004` | AC-17, IA-2, IA-5 | Remote access, identification, authenticator management |
| `TL-NET-001`, `TL-NET-002` | SC-7, AC-4 | Boundary protection, information flow enforcement |
| `TL-CRYPTO-001`, `TL-CRYPTO-002`, `TL-CRYPTO-003` | SC-12, SC-13 | Cryptographic key establishment, protection |
| `TL-CRYPTO-004` | SC-28, SI-7 | Protection of information at rest, software integrity |
| `TL-INFRA-003` | IA-2, IA-5 | Identification, authenticator management |

### HIPAA Security Rule

| Sentinel | HIPAA Standard | Rationale |
| --- | --- | --- |
| `TL-INFRA-001`, `TL-INFRA-002`, `TL-INFRA-004` | 164.312(d) | Person or entity authentication |
| `TL-NET-001`, `TL-NET-002` | 164.312(e)(1) | Transmission security |
| `TL-CRYPTO-001`, `TL-CRYPTO-002`, `TL-CRYPTO-003` | 164.312(a)(2)(iv) | Encryption and decryption |
| `TL-CRYPTO-004` | 164.312(a)(2)(iv), 164.312(e)(2)(ii) | Encryption mechanism |

## Evidence Collection

### Terraform State

Infrastructure compliance can be verified via Terraform state inspection:

```bash
# Verify server hardening configuration
terraform show -json | jq '.values.root_module.resources[] | select(.type == "hcloud_server")'

# Verify Key Vault RBAC
terraform show -json | jq '.values.root_module.resources[] | select(.type == "azurerm_key_vault") | .values.rbac_authorization_enabled'

# Verify confidential VM settings
terraform show -json | jq '.values.root_module.resources[] | select(.type == "azurerm_linux_virtual_machine") | {vtpm: .values.vtpm_enabled, secure_boot: .values.secure_boot_enabled}'
```

### Ansible Playbook Evidence

Server configuration compliance can be verified by running configuration checks:

```bash
# Verify SSH configuration
ssh user@host 'grep -E "^PermitRootLogin" /etc/ssh/sshd_config'

# Verify journald retention
ssh user@host 'cat /etc/systemd/journald.conf.d/compliance.conf'
```
