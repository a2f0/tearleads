# Infrastructure Security Procedure (SOC2)

<!-- COMPLIANCE_SENTINEL: TL-INFRA-004 | policy=compliance/SOC2/policies/04-infrastructure-security-policy.md | procedure=compliance/SOC2/procedures/04-infrastructure-security-procedure.md | control=ssh-hardening -->
<!-- COMPLIANCE_SENTINEL: TL-NET-003 | policy=compliance/SOC2/policies/04-infrastructure-security-policy.md | procedure=compliance/SOC2/procedures/04-infrastructure-security-procedure.md | control=host-firewall -->
<!-- COMPLIANCE_SENTINEL: TL-NET-004 | policy=compliance/SOC2/policies/04-infrastructure-security-policy.md | procedure=compliance/SOC2/procedures/04-infrastructure-security-procedure.md | control=infrastructure-firewall -->
<!-- COMPLIANCE_SENTINEL: TL-KERN-001 | policy=compliance/SOC2/policies/04-infrastructure-security-policy.md | procedure=compliance/SOC2/procedures/04-infrastructure-security-procedure.md | control=kernel-hardening -->
<!-- COMPLIANCE_SENTINEL: TL-AUTH-001 | policy=compliance/SOC2/policies/04-infrastructure-security-policy.md | procedure=compliance/SOC2/procedures/04-infrastructure-security-procedure.md | control=brute-force-protection -->
<!-- COMPLIANCE_SENTINEL: TL-SVC-001 | policy=compliance/SOC2/policies/04-infrastructure-security-policy.md | procedure=compliance/SOC2/procedures/04-infrastructure-security-procedure.md | control=api-service-sandboxing -->
<!-- COMPLIANCE_SENTINEL: TL-SVC-002 | policy=compliance/SOC2/policies/04-infrastructure-security-policy.md | procedure=compliance/SOC2/procedures/04-infrastructure-security-procedure.md | control=smtp-service-sandboxing -->
<!-- COMPLIANCE_SENTINEL: TL-CRYPTO-005 | policy=compliance/SOC2/policies/04-infrastructure-security-policy.md | procedure=compliance/SOC2/procedures/04-infrastructure-security-procedure.md | control=key-vault-protection -->

## Frequency

- Execute at least quarterly.
- Execute after any infrastructure change that affects security configuration.
- Execute after any Ansible playbook or Terraform deployment that includes security controls.

## Procedure Steps

1. Verify SSH hardening configuration is deployed with all required settings.
2. Verify UFW firewall is enabled with default-deny policy.
3. Verify Hetzner Cloud firewall rules match expected configuration.
4. Verify kernel hardening sysctl parameters are applied.
5. Verify fail2ban is running with SSH jail active.
6. Verify systemd service sandboxing is applied to application services.
7. Verify Azure Key Vault has purge protection enabled.
8. Record evidence (configuration state, test results, reviewer).

## Verification Commands

### SSH Hardening (TL-INFRA-004)

```bash
# Verify SSH configuration
grep -E "^(PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|Protocol|MaxAuthTries|X11Forwarding|AllowTcpForwarding)" /etc/ssh/sshd_config

# Verify SSH is using expected ciphers
sshd -T | grep -E "^(ciphers|macs|kexalgorithms)"

# Verify SSH service status
systemctl status ssh
```

### Host Firewall (TL-NET-003)

```bash
# Verify UFW status and rules
sudo ufw status verbose

# Verify default policies
sudo ufw status | grep -E "^Default:"

# List all rules with numbers
sudo ufw status numbered
```

### Infrastructure Firewall (TL-NET-004)

```bash
# Verify Hetzner firewall via Terraform state (run from terraform directory)
terraform show -json | jq '.values.root_module.resources[] | select(.type == "hcloud_firewall") | .values'

# Or via Hetzner CLI
hcloud firewall list
hcloud firewall describe <firewall-name>
```

### Kernel Hardening (TL-KERN-001)

```bash
# Verify sysctl configuration file
cat /etc/sysctl.d/99-security-hardening.conf

# Verify key parameters are active
sysctl net.ipv4.conf.all.rp_filter
sysctl net.ipv4.tcp_syncookies
sysctl kernel.randomize_va_space
sysctl kernel.kptr_restrict
sysctl kernel.yama.ptrace_scope

# Verify all custom parameters
sysctl -a 2>/dev/null | grep -E "(rp_filter|tcp_syncookies|randomize_va_space|kptr_restrict|ptrace_scope)"
```

### Brute-Force Protection (TL-AUTH-001)

```bash
# Verify fail2ban service status
systemctl status fail2ban

# Verify SSH jail is active
sudo fail2ban-client status sshd

# Check current ban statistics
sudo fail2ban-client status sshd | grep -E "(Currently banned|Total banned)"

# View fail2ban jail configuration
cat /etc/fail2ban/jail.d/sshd.conf
```

### Service Sandboxing (TL-SVC-001, TL-SVC-002)

```bash
# Verify API service hardening
systemctl show tearleads-api --property=NoNewPrivileges,ProtectSystem,ProtectHome,PrivateTmp,PrivateDevices,RestrictNamespaces,MemoryDenyWriteExecute

# Verify SMTP service hardening
systemctl show tearleads-smtp-listener --property=NoNewPrivileges,ProtectSystem,ProtectHome,PrivateTmp,PrivateDevices,RestrictNamespaces,AmbientCapabilities

# View full service security status
systemd-analyze security tearleads-api
systemd-analyze security tearleads-smtp-listener
```

### Key Vault Protection (TL-CRYPTO-005)

```bash
# Verify Key Vault settings via Terraform state (run from tee directory)
terraform show -json | jq '.values.root_module.resources[] | select(.type == "azurerm_key_vault") | {purge_protection: .values.purge_protection_enabled, soft_delete_days: .values.soft_delete_retention_days, sku: .values.sku_name}'

# Or via Azure CLI
az keyvault show --name <vault-name> --query "{purgeProtection:properties.enablePurgeProtection, softDeleteRetention:properties.softDeleteRetentionInDays, sku:properties.sku.name}"
```

## Evidence Template

- Review date:
- Reviewer:
- Ansible playbook commit SHA:
- Terraform state version:
- Controls verified: `TL-INFRA-004`, `TL-NET-003`, `TL-NET-004`, `TL-KERN-001`, `TL-AUTH-001`, `TL-SVC-001`, `TL-SVC-002`, `TL-CRYPTO-005`
- Verification commands run:
- Configuration state summary:
  - SSH hardening: [PASS/FAIL]
  - UFW firewall: [PASS/FAIL]
  - Hetzner firewall: [PASS/FAIL]
  - Kernel hardening: [PASS/FAIL]
  - Fail2ban: [PASS/FAIL]
  - Service sandboxing: [PASS/FAIL]
  - Key Vault protection: [PASS/FAIL]
- Exceptions or remediation tasks:
