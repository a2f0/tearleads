# Infrastructure Security Technical Control Map (NIST SP 800-53)

This map ties infrastructure security policy controls to concrete implementation and test evidence, aligned with NIST SP 800-53 Revision 5 control families.

## Sentinel Controls

| Sentinel | NIST Controls | Description | Implementation Evidence | Test Evidence |
| --- | --- | --- | --- | --- |
| `TL-NINFRA-004` | AC-17, IA-2, IA-5 | SSH hardening with key-only auth, modern ciphers | `ansible/playbooks/templates/sshd_config.j2` | `ssh user@host 'grep -E "^(PermitRootLogin\|PasswordAuthentication)" /etc/ssh/sshd_config'` |
| `TL-NNET-003` | SC-7 | UFW host firewall with default-deny incoming | `ansible/playbooks/main.yml` (UFW tasks) | `ssh user@host 'sudo ufw status verbose'` |
| `TL-NNET-004` | SC-7 | Hetzner Cloud firewall with explicit port rules | `terraform/modules/hetzner-server/main.tf` (hcloud_firewall) | `terraform show -json \| jq '.values.root_module.resources[] \| select(.type == "hcloud_firewall")'` |
| `TL-NET-006` | SC-7 | Cloudflare Tunnel isolation for inbound traffic | `terraform/modules/cloudflare-tunnel/main.tf` | `terraform show -json \| jq '.values.root_module.resources[] \| select(.type == "cloudflare_tunnel")'` |
| `TL-NKERN-001` | SC-5, SI-16 | Kernel sysctl hardening (ASLR, rp_filter, syncookies) | `ansible/playbooks/templates/99-security-hardening.conf.j2` | `ssh user@host 'sysctl kernel.randomize_va_space net.ipv4.tcp_syncookies'` |
| `TL-NAUTH-001` | AC-7 | Fail2ban SSH jail with progressive bans | `ansible/playbooks/templates/fail2ban-sshd.conf.j2` | `ssh user@host 'sudo fail2ban-client status sshd'` |
| `TL-NSVC-001` | SC-7, AC-6 | API service systemd sandboxing | `ansible/playbooks/templates/tearleads-api.service.j2` | `ssh user@host 'systemctl show tearleads-api --property=NoNewPrivileges,ProtectSystem'` |
| `TL-NSVC-002` | SC-7, AC-6 | SMTP service systemd sandboxing with CAP_NET_BIND | `ansible/playbooks/templates/tearleads-smtp-listener.service.j2` | `ssh user@host 'systemctl show tearleads-smtp-listener --property=AmbientCapabilities'` |
| `TL-NCRYPTO-005` | SC-12 | Key Vault purge protection and soft-delete | `terraform/stacks/*/tee/versions.tf` | `terraform show -json \| jq '.values.root_module.resources[] \| select(.type == "azurerm_key_vault") \| .values.purge_protection_enabled'` |

## NIST Control Family Mapping

### AC - Access Control

| Control | Implementation | Sentinel |
| --- | --- | --- |
| AC-6 (Least Privilege) | Services run as www-data with restricted permissions | `TL-NSVC-001`, `TL-NSVC-002` |
| AC-7 (Unsuccessful Logon Attempts) | Fail2ban bans after 3 failed SSH attempts | `TL-NAUTH-001` |
| AC-17 (Remote Access) | SSH hardening with key-only auth, disabled features | `TL-NINFRA-004` |

### IA - Identification and Authentication

| Control | Implementation | Sentinel |
| --- | --- | --- |
| IA-2 (Identification and Authentication) | SSH public key authentication required | `TL-NINFRA-004` |
| IA-5 (Authenticator Management) | Modern SSH ciphers, key-only auth | `TL-NINFRA-004` |

### SC - System and Communications Protection

| Control | Implementation | Sentinel |
| --- | --- | --- |
| SC-5 (Denial-of-Service Protection) | TCP syncookies, ICMP limits, rp_filter | `TL-NKERN-001` |
| SC-7 (Boundary Protection) | UFW and Hetzner firewalls with default-deny | `TL-NNET-003`, `TL-NNET-004` |
| SC-12 (Cryptographic Key Management) | Key Vault with purge protection | `TL-NCRYPTO-005` |

### SI - System and Information Integrity

| Control | Implementation | Sentinel |
| --- | --- | --- |
| SI-16 (Memory Protection) | ASLR, ptrace restrictions, dmesg restrictions | `TL-NKERN-001` |

## Control Details

### TL-NINFRA-004: SSH Hardening (AC-17, IA-2, IA-5)

**NIST Requirements Addressed:**

- AC-17: Authorize, monitor, control remote access
- IA-2: Uniquely identify and authenticate organizational users
- IA-5: Manage authenticators (require strong authentication)

**Implementation:**

- `ansible/playbooks/templates/sshd_config.j2` - SSH server configuration
- `ansible/playbooks/main.yml` - Deployment task

**Key Configuration:**

- `PermitRootLogin no` - AC-17 (controlled access)
- `PasswordAuthentication no` - IA-5 (strong authenticators)
- `PubkeyAuthentication yes` - IA-2 (unique identification)
- `MaxAuthTries 3` - AC-7 (limit attempts)
- Modern ciphers: chacha20-poly1305, aes256-gcm - IA-5 (FIPS-compatible)

### TL-NNET-003 / TL-NNET-004: Boundary Protection (SC-7)

**NIST Requirements Addressed:**

- SC-7: Monitor and control communications at external boundaries

**Implementation:**

- `ansible/playbooks/main.yml` - UFW configuration
- `terraform/modules/hetzner-server/main.tf` - Hetzner Cloud firewall

**Key Configuration:**

- Default deny incoming (SC-7a: deny by default)
- Explicit allow for required services (SC-7b: authorized connections)
- Defense-in-depth with both host and infrastructure firewalls (SC-7c: multiple layers)

### TL-NKERN-001: DoS and Memory Protection (SC-5, SI-16)

**NIST Requirements Addressed:**

- SC-5: Protect against denial-of-service attacks
- SI-16: Implement memory protection mechanisms

**Implementation:**

- `ansible/playbooks/templates/99-security-hardening.conf.j2`

**Key Parameters:**

- `net.ipv4.tcp_syncookies = 1` - SC-5 (SYN flood protection)
- `net.ipv4.conf.all.rp_filter = 1` - SC-5 (IP spoofing prevention)
- `kernel.randomize_va_space = 2` - SI-16 (ASLR)
- `kernel.kptr_restrict = 2` - SI-16 (address leak prevention)
- `kernel.yama.ptrace_scope = 2` - SI-16 (anti-debugging)

### TL-NAUTH-001: Unsuccessful Logon Attempts (AC-7)

**NIST Requirements Addressed:**

- AC-7: Limit consecutive invalid logon attempts

**Implementation:**

- `ansible/playbooks/templates/fail2ban-sshd.conf.j2`

**Key Configuration:**

- `maxretry = 3` - AC-7a (defined threshold)
- `bantime = 1h` - AC-7b (account lockout)
- `bantime.increment = true` - AC-7 enhancement (increasing delays)
- `banaction = ufw` - Integrated with boundary protection

### TL-NSVC-001 / TL-NSVC-002: Least Privilege (AC-6)

**NIST Requirements Addressed:**

- AC-6: Employ principle of least privilege

**Implementation:**

- `ansible/playbooks/templates/tearleads-api.service.j2`
- `ansible/playbooks/templates/tearleads-smtp-listener.service.j2`

**Key Hardening:**

- `User=www-data` - AC-6 (non-privileged user)
- `NoNewPrivileges=true` - AC-6 (prevent escalation)
- `RestrictNamespaces=true` - AC-6 (limit capabilities)
- `SystemCallFilter=@system-service` - AC-6 (syscall restrictions)
- `AmbientCapabilities=CAP_NET_BIND_SERVICE` - AC-6 (minimum capability for port 25)

### TL-NCRYPTO-005: Cryptographic Key Management (SC-12)

**NIST Requirements Addressed:**

- SC-12: Establish and manage cryptographic keys

**Implementation:**

- `terraform/modules/azure-tee/main.tf` - Azure Key Vault configuration
- `terraform/stacks/*/tee/versions.tf` - Provider settings enabling protection features

**Key Configuration:**

- `purge_protection_enabled = true` - SC-12 (protect keys from deletion)
- `soft_delete_retention_days = 90` - SC-12 (recovery window)
- `purge_soft_delete_on_destroy = false` - SC-12 (preserve on infrastructure changes)

## Notes

- All infrastructure security controls are deployed via Ansible and Terraform.
- Evidence collection should reference NIST SP 800-53A assessment procedures.
- Systemd security scores can be obtained via `systemd-analyze security <service>`.
- Control effectiveness should be assessed per CA-2 (Control Assessments) requirements.
