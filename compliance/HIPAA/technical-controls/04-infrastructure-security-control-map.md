# Infrastructure Security Technical Control Map (HIPAA)

This map ties infrastructure security policy controls to concrete implementation and test evidence, aligned with HIPAA Security Rule requirements.

## Sentinel Controls

| Sentinel | HIPAA Standard | Description | Implementation Evidence | Test Evidence |
| --- | --- | --- | --- | --- |
| `TL-HINFRA-004` | 164.312(d), 164.312(a)(2)(iii) | SSH hardening with key-only auth, session timeout | `ansible/playbooks/templates/sshd_config.j2` | `ssh user@host 'grep -E "^(PermitRootLogin\|PasswordAuthentication\|ClientAliveInterval)" /etc/ssh/sshd_config'` |
| `TL-HNET-003` | 164.312(e)(1) | UFW host firewall with default-deny incoming | `ansible/playbooks/main.yml` (UFW tasks) | `ssh user@host 'sudo ufw status verbose'` |
| `TL-HNET-004` | 164.312(e)(1) | Hetzner Cloud firewall with explicit port rules | `terraform/modules/hetzner-server/main.tf` (hcloud_firewall) | `terraform show -json \| jq '.values.root_module.resources[] \| select(.type == "hcloud_firewall")'` |
| `TL-NET-006` | 164.312(e)(1) | Cloudflare Tunnel isolation for inbound traffic | `terraform/modules/cloudflare-tunnel/main.tf` | `terraform show -json \| jq '.values.root_module.resources[] \| select(.type == "cloudflare_tunnel")'` |
| `TL-HKERN-001` | - | Kernel sysctl hardening (ASLR, rp_filter, syncookies) | `ansible/playbooks/templates/99-security-hardening.conf.j2` | `ssh user@host 'sysctl kernel.randomize_va_space net.ipv4.tcp_syncookies'` |
| `TL-HAUTH-001` | 164.312(d) | Fail2ban SSH jail with progressive lockout | `ansible/playbooks/templates/fail2ban-sshd.conf.j2` | `ssh user@host 'sudo fail2ban-client status sshd'` |
| `TL-HSVC-001` | 164.312(a)(1) | API service systemd sandboxing | `ansible/playbooks/templates/tearleads-api.service.j2` | `ssh user@host 'systemctl show tearleads-api --property=NoNewPrivileges,ProtectSystem'` |
| `TL-HSVC-002` | 164.312(a)(1) | SMTP service systemd sandboxing with CAP_NET_BIND | `ansible/playbooks/templates/tearleads-smtp-listener.service.j2` | `ssh user@host 'systemctl show tearleads-smtp-listener --property=AmbientCapabilities'` |
| `TL-HCRYPTO-005` | 164.312(a)(2)(iv) | Key Vault purge protection and soft-delete | `terraform/stacks/*/tee/versions.tf` | `terraform show -json \| jq '.values.root_module.resources[] \| select(.type == "azurerm_key_vault") \| .values.purge_protection_enabled'` |

## HIPAA Security Rule Mapping

### Technical Safeguards (164.312)

| Standard | Implementation Specification | Implementation | Sentinel |
| --- | --- | --- | --- |
| 164.312(a)(1) Access Control | Required | Services run as www-data with systemd sandboxing | `TL-HSVC-001`, `TL-HSVC-002` |
| 164.312(a)(2)(iii) Automatic Logoff | Addressable | SSH session timeout (300s + 2 keepalives) | `TL-HINFRA-004` |
| 164.312(a)(2)(iv) Encryption | Addressable | Key Vault with purge protection, Premium SKU | `TL-HCRYPTO-005` |
| 164.312(d) Authentication | Required | SSH key-only auth, fail2ban lockout | `TL-HINFRA-004`, `TL-HAUTH-001` |
| 164.312(e)(1) Transmission Security | Required | UFW and Hetzner firewalls with default-deny | `TL-HNET-003`, `TL-HNET-004` |

## Control Details

### TL-HINFRA-004: Person or Entity Authentication (164.312(d))

**HIPAA Requirements Addressed:**

- 164.312(d): Verify identity of person/entity seeking access to ePHI
- 164.312(a)(2)(iii): Implement automatic logoff procedures

**Implementation:**

- `ansible/playbooks/templates/sshd_config.j2` - SSH server configuration
- `ansible/playbooks/main.yml` - Deployment task

**Key Configuration:**

- `PermitRootLogin no` - Prevent unauthorized privileged access
- `PasswordAuthentication no` - Require strong authentication (public key)
- `PubkeyAuthentication yes` - Enable cryptographic authentication
- `MaxAuthTries 3` - Limit authentication attempts
- `ClientAliveInterval 300` + `ClientAliveCountMax 2` - Automatic logoff after inactivity
- Modern ciphers: chacha20-poly1305, aes256-gcm

### TL-HNET-003 / TL-HNET-004: Transmission Security (164.312(e)(1))

**HIPAA Requirements Addressed:**

- 164.312(e)(1): Guard against unauthorized access to ePHI during transmission

**Implementation:**

- `ansible/playbooks/main.yml` - UFW configuration
- `terraform/modules/hetzner-server/main.tf` - Hetzner Cloud firewall

**Key Configuration:**

- Default deny incoming (prevent unauthorized transmission access)
- Explicit allow for required services only
- Defense-in-depth with both host and infrastructure firewalls
- Version-controlled firewall rules for auditability

### TL-HAUTH-001: Authentication Protection (164.312(d))

**HIPAA Requirements Addressed:**

- 164.312(d): Implement procedures to verify person/entity identity

**Implementation:**

- `ansible/playbooks/templates/fail2ban-sshd.conf.j2`

**Key Configuration:**

- `maxretry = 3` - Lock out after failed attempts
- `bantime = 1h` - Initial lockout duration
- `bantime.increment = true` - Increasing lockout for repeat offenders
- `banaction = ufw` - Integrated with transmission security controls

### TL-HSVC-001 / TL-HSVC-002: Access Control (164.312(a)(1))

**HIPAA Requirements Addressed:**

- 164.312(a)(1): Allow access only to persons/software with access rights

**Implementation:**

- `ansible/playbooks/templates/tearleads-api.service.j2`
- `ansible/playbooks/templates/tearleads-smtp-listener.service.j2`

**Key Hardening:**

- `User=www-data` - Non-privileged service account
- `NoNewPrivileges=true` - Prevent privilege escalation
- `ProtectSystem=strict` - Read-only filesystem
- `RestrictNamespaces=true` - Prevent namespace escape
- `SystemCallFilter=@system-service` - Limit kernel interface
- `AmbientCapabilities=CAP_NET_BIND_SERVICE` - Minimum capability for SMTP

### TL-HKERN-001: System Integrity

**HIPAA Requirements Addressed:**

- Supports overall security posture for ePHI protection

**Implementation:**

- `ansible/playbooks/templates/99-security-hardening.conf.j2`

**Key Parameters:**

- `kernel.randomize_va_space = 2` - Memory protection (ASLR)
- `net.ipv4.tcp_syncookies = 1` - DoS protection
- `net.ipv4.conf.all.rp_filter = 1` - IP spoofing prevention
- `kernel.kptr_restrict = 2` - Address leak prevention

### TL-HCRYPTO-005: Encryption (164.312(a)(2)(iv))

**HIPAA Requirements Addressed:**

- 164.312(a)(2)(iv): Implement mechanism to encrypt and decrypt ePHI

**Implementation:**

- `terraform/modules/azure-tee/main.tf` - Azure Key Vault configuration
- `terraform/stacks/*/tee/versions.tf` - Provider settings enabling protection features

**Key Configuration:**

- `purge_protection_enabled = true` - Protect encryption keys from deletion
- `soft_delete_retention_days = 90` - Extended key recovery window
- `sku_name = "premium"` - HSM-capable tier for key protection
- `purge_soft_delete_on_destroy = false` - Preserve keys on infrastructure changes

## Notes

- All infrastructure security controls are deployed via Ansible and Terraform.
- Evidence should be retained for 6 years per 164.316(b) documentation requirements.
- Controls should be evaluated per 164.308(a)(8) (Evaluation) requirements.
- Systemd security scores can be obtained via `systemd-analyze security <service>`.
