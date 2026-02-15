# Infrastructure Security Technical Control Map

This map ties infrastructure security policy controls to concrete implementation and test evidence.

## Sentinel Controls

| Sentinel | Description | Implementation Evidence | Test Evidence |
| --- | --- | --- | --- |
| `TL-INFRA-004` | SSH hardening with key-only auth, modern ciphers, rate limiting | `ansible/playbooks/templates/sshd_config.j2`, `ansible/playbooks/main.yml` | `ssh user@host 'grep -E "^(PermitRootLogin\|PasswordAuthentication)" /etc/ssh/sshd_config'` |
| `TL-NET-003` | UFW host firewall with default-deny incoming | `ansible/playbooks/main.yml` (UFW tasks) | `ssh user@host 'sudo ufw status verbose'` |
| `TL-NET-004` | Hetzner Cloud firewall with explicit port rules | `terraform/main.tf` (hcloud_firewall resource) | `terraform show -json \| jq '.values.root_module.resources[] \| select(.type == "hcloud_firewall")'` |
| `TL-KERN-001` | Kernel sysctl hardening (ASLR, rp_filter, ptrace) | `ansible/playbooks/templates/99-security-hardening.conf.j2`, `ansible/playbooks/main.yml` | `ssh user@host 'sysctl kernel.randomize_va_space net.ipv4.conf.all.rp_filter'` |
| `TL-AUTH-001` | Fail2ban SSH jail with progressive bans | `ansible/playbooks/templates/fail2ban-sshd.conf.j2`, `ansible/playbooks/main.yml` | `ssh user@host 'sudo fail2ban-client status sshd'` |
| `TL-SVC-001` | API service systemd sandboxing | `ansible/playbooks/templates/tearleads-api.service.j2` | `ssh user@host 'systemctl show tearleads-api --property=NoNewPrivileges,ProtectSystem,RestrictNamespaces'` |
| `TL-SVC-002` | SMTP service systemd sandboxing with CAP_NET_BIND_SERVICE | `ansible/playbooks/templates/tearleads-smtp-listener.service.j2` | `ssh user@host 'systemctl show tearleads-smtp-listener --property=AmbientCapabilities,NoNewPrivileges'` |
| `TL-CRYPTO-005` | Key Vault purge protection and soft-delete recovery | `tee/kms.tf`, `tee/versions.tf` | `terraform show -json \| jq '.values.root_module.resources[] \| select(.type == "azurerm_key_vault") \| .values.purge_protection_enabled'` |

## Control Details

### TL-INFRA-004: SSH Hardening

**Implementation Files:**

- `ansible/playbooks/templates/sshd_config.j2` - SSH server configuration template
- `ansible/playbooks/main.yml` - Playbook task deploying the template

**Key Configuration:**

- `PermitRootLogin no` - Disable root SSH access
- `PasswordAuthentication no` - Require key-based auth
- `PubkeyAuthentication yes` - Enable public key auth
- `MaxAuthTries 3` - Limit authentication attempts
- `Protocol 2` - Use SSH protocol version 2 only
- Modern ciphers: chacha20-poly1305, aes256-gcm
- Modern KEX: curve25519-sha256, diffie-hellman-group16-sha512

### TL-NET-003: Host Firewall (UFW)

**Implementation Files:**

- `ansible/playbooks/main.yml` - UFW configuration tasks

**Key Configuration:**

- Default deny incoming
- Default allow outgoing
- Allow TCP 22 (SSH)
- Allow TCP 80 (HTTP)
- Allow TCP 443 (HTTPS)
- Allow TCP 25 (SMTP)

### TL-NET-004: Infrastructure Firewall (Hetzner)

**Implementation Files:**

- `terraform/main.tf` - `hcloud_firewall` resource

**Key Configuration:**

- Inbound rules for SSH, HTTP, HTTPS, SMTP, ICMP
- Firewall attached to server via `firewall_ids`

### TL-KERN-001: Kernel Hardening

**Implementation Files:**

- `ansible/playbooks/templates/99-security-hardening.conf.j2` - Sysctl configuration
- `ansible/playbooks/main.yml` - Deployment task

**Key Parameters:**

- `kernel.randomize_va_space = 2` - Full ASLR
- `net.ipv4.conf.all.rp_filter = 1` - Reverse path filtering
- `net.ipv4.tcp_syncookies = 1` - SYN flood protection
- `kernel.kptr_restrict = 2` - Hide kernel pointers
- `kernel.yama.ptrace_scope = 2` - Restrict ptrace
- `kernel.dmesg_restrict = 1` - Restrict dmesg access

### TL-AUTH-001: Brute-Force Protection

**Implementation Files:**

- `ansible/playbooks/templates/fail2ban-sshd.conf.j2` - Fail2ban jail configuration
- `ansible/playbooks/main.yml` - Deployment and enablement tasks

**Key Configuration:**

- `maxretry = 3` - Ban after 3 failed attempts
- `findtime = 10m` - Look for failures within 10 minutes
- `bantime = 1h` - Initial ban duration
- `bantime.increment = true` - Progressive ban times
- `bantime.maxtime = 1w` - Maximum ban of 1 week
- `banaction = ufw` - Use UFW for banning

### TL-SVC-001 / TL-SVC-002: Service Sandboxing

**Implementation Files:**

- `ansible/playbooks/templates/tearleads-api.service.j2` - API service unit
- `ansible/playbooks/templates/tearleads-smtp-listener.service.j2` - SMTP service unit

**Key Hardening Directives:**

- `NoNewPrivileges=true` - Prevent privilege escalation
- `ProtectSystem=strict` - Read-only filesystem
- `ProtectHome=true` - Block home directory access
- `PrivateTmp=true` - Isolated /tmp namespace
- `PrivateDevices=true` - Hide block devices
- `RestrictNamespaces=true` - Prevent namespace creation
- `MemoryDenyWriteExecute=true` - W^X enforcement
- `SystemCallFilter=@system-service` - Syscall allowlisting
- `AmbientCapabilities=CAP_NET_BIND_SERVICE` - (SMTP only) Allow port 25 binding

### TL-CRYPTO-005: Key Vault Protection

**Implementation Files:**

- `tee/kms.tf` - Key Vault resource configuration
- `tee/versions.tf` - Provider configuration

**Key Configuration:**

- `purge_protection_enabled = true` - Prevent permanent deletion
- `soft_delete_retention_days = 90` - Extended recovery window
- `sku_name = "premium"` - HSM-capable tier
- `purge_soft_delete_on_destroy = false` - Preserve on terraform destroy
- `recover_soft_deleted_key_vaults = true` - Auto-recovery on re-create

## Notes

- All infrastructure security controls are deployed via Ansible and Terraform.
- Evidence collection should use the verification commands in the procedure document.
- Systemd security scores can be obtained via `systemd-analyze security <service>`.
