# Infrastructure Security Technical Control Map

This map ties infrastructure security policy controls to concrete implementation and test evidence.

## Sentinel Controls

| Sentinel | Description | Implementation Evidence | Test Evidence |
| --- | --- | --- | --- |
| `TL-INFRA-004` | SSH hardening with key-only auth and auth attempt limits | `ansible/playbooks/k8s.yml` | `ssh user@host 'grep -E "^(PermitRootLogin\|PasswordAuthentication\|PubkeyAuthentication\|MaxAuthTries)" /etc/ssh/sshd_config'` |
| `TL-NET-003` | UFW host firewall with default-deny incoming | `terraform/stacks/staging/k8s/main.tf` (UFW tasks) | `ssh user@host 'sudo ufw status verbose'` |
| `TL-NET-004` | Hetzner Cloud firewall with explicit port rules | `terraform/modules/hetzner-server/main.tf` (hcloud_firewall resource) | `terraform show -json \| jq '.values.root_module.resources[] \| select(.type == "hcloud_firewall")'` |
| `TL-NET-006` | Cloudflare Tunnel isolation for inbound traffic | `terraform/modules/cloudflare-tunnel/main.tf` | `terraform show -json \| jq '.values.root_module.resources[] \| select(.type == "cloudflare_tunnel")'` |
| `TL-KERN-001` | Kernel sysctl hardening (ASLR, rp_filter, ptrace) | `terraform/stacks/staging/k8s/main.tf`, `terraform/stacks/staging/k8s/main.tf` | `ssh user@host 'sysctl kernel.randomize_va_space net.ipv4.conf.all.rp_filter'` |
| `TL-AUTH-001` | Fail2ban SSH jail with progressive bans | `terraform/stacks/staging/k8s/main.tf`, `terraform/stacks/staging/k8s/main.tf` | `ssh user@host 'sudo fail2ban-client status sshd'` |
| `TL-SVC-001` | API service systemd sandboxing | `terraform/stacks/staging/k8s/main.tf` | `ssh user@host 'systemctl show tearleads-api --property=NoNewPrivileges,ProtectSystem,RestrictNamespaces'` |
| `TL-SVC-002` | SMTP service systemd sandboxing with CAP_NET_BIND_SERVICE | `terraform/stacks/staging/k8s/main.tf` | `ssh user@host 'systemctl show tearleads-smtp-listener --property=AmbientCapabilities,NoNewPrivileges'` |
| `TL-CRYPTO-005` | Key Vault purge protection and soft-delete recovery | `terraform/stacks/*/tee/versions.tf` | `terraform show -json \| jq '.values.root_module.resources[] \| select(.type == "azurerm_key_vault") \| .values.purge_protection_enabled'` |

## Control Details

### TL-INFRA-004: SSH Hardening

**Implementation Files:**

- `terraform/stacks/staging/k8s/main.tf` - SSH server configuration template
- `terraform/stacks/staging/k8s/main.tf` - Playbook task deploying the template

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

- `terraform/stacks/staging/k8s/main.tf` - UFW configuration tasks

**Key Configuration:**

- Default deny incoming
- Default allow outgoing
- Allow TCP 22 (SSH)
- Allow TCP 80 (HTTP)
- Allow TCP 443 (HTTPS)
- Allow TCP 25 (SMTP)

### TL-NET-004: Infrastructure Firewall (Hetzner)

**Implementation Files:**

- `terraform/modules/hetzner-server/main.tf` - `hcloud_firewall` resource

**Key Configuration:**

- Inbound rules for SSH, HTTP, HTTPS, SMTP, ICMP
- Firewall attached to server via `firewall_ids`

### TL-KERN-001: Kernel Hardening

**Implementation Files:**

- `terraform/stacks/staging/k8s/main.tf` - Sysctl configuration
- `terraform/stacks/staging/k8s/main.tf` - Deployment task

**Key Parameters:**

- `kernel.randomize_va_space = 2` - Full ASLR
- `net.ipv4.conf.all.rp_filter = 1` - Reverse path filtering
- `net.ipv4.tcp_syncookies = 1` - SYN flood protection
- `kernel.kptr_restrict = 2` - Hide kernel pointers
- `kernel.yama.ptrace_scope = 2` - Restrict ptrace
- `kernel.dmesg_restrict = 1` - Restrict dmesg access

### TL-AUTH-001: Brute-Force Protection

**Implementation Files:**

- `terraform/stacks/staging/k8s/main.tf` - Fail2ban jail configuration
- `terraform/stacks/staging/k8s/main.tf` - Deployment and enablement tasks

**Key Configuration:**

- `maxretry = 3` - Ban after 3 failed attempts
- `findtime = 10m` - Look for failures within 10 minutes
- `bantime = 1h` - Initial ban duration
- `bantime.increment = true` - Progressive ban times
- `bantime.maxtime = 1w` - Maximum ban of 1 week
- `banaction = ufw` - Use UFW for banning

### TL-SVC-001 / TL-SVC-002: Service Sandboxing

**Implementation Files:**

- `terraform/stacks/staging/k8s/main.tf` - API service unit
- `terraform/stacks/staging/k8s/main.tf` - SMTP service unit

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

- `terraform/modules/azure-tee/main.tf` - Key Vault resource configuration
- `terraform/stacks/*/tee/versions.tf` - Provider configuration enabling protection features

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
