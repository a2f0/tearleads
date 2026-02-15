# Infrastructure Security Procedure (NIST SP 800-53)

<!-- COMPLIANCE_SENTINEL: TL-NINFRA-004 | policy=compliance/NIST.SP.800-53/policies/04-infrastructure-security-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-infrastructure-security-procedure.md | control=ssh-hardening -->
<!-- COMPLIANCE_SENTINEL: TL-NNET-003 | policy=compliance/NIST.SP.800-53/policies/04-infrastructure-security-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-infrastructure-security-procedure.md | control=host-firewall -->
<!-- COMPLIANCE_SENTINEL: TL-NNET-004 | policy=compliance/NIST.SP.800-53/policies/04-infrastructure-security-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-infrastructure-security-procedure.md | control=infrastructure-firewall -->
<!-- COMPLIANCE_SENTINEL: TL-NKERN-001 | policy=compliance/NIST.SP.800-53/policies/04-infrastructure-security-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-infrastructure-security-procedure.md | control=kernel-hardening -->
<!-- COMPLIANCE_SENTINEL: TL-NAUTH-001 | policy=compliance/NIST.SP.800-53/policies/04-infrastructure-security-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-infrastructure-security-procedure.md | control=brute-force-protection -->
<!-- COMPLIANCE_SENTINEL: TL-NSVC-001 | policy=compliance/NIST.SP.800-53/policies/04-infrastructure-security-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-infrastructure-security-procedure.md | control=api-service-sandboxing -->
<!-- COMPLIANCE_SENTINEL: TL-NSVC-002 | policy=compliance/NIST.SP.800-53/policies/04-infrastructure-security-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-infrastructure-security-procedure.md | control=smtp-service-sandboxing -->
<!-- COMPLIANCE_SENTINEL: TL-NCRYPTO-005 | policy=compliance/NIST.SP.800-53/policies/04-infrastructure-security-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-infrastructure-security-procedure.md | control=key-vault-protection -->

## Frequency

- Execute at least quarterly per CA-7 (Continuous Monitoring) requirements.
- Execute after any infrastructure change that affects security configuration.
- Execute after any Ansible playbook or Terraform deployment that includes security controls.

## Procedure Steps

1. Verify SSH hardening configuration meets AC-17, IA-2, IA-5 requirements.
2. Verify UFW firewall is enabled with default-deny policy per SC-7.
3. Verify Hetzner Cloud firewall rules match expected configuration per SC-7.
4. Verify kernel hardening sysctl parameters are applied per SC-5, SI-16.
5. Verify fail2ban is running with SSH jail active per AC-7.
6. Verify systemd service sandboxing is applied per AC-6.
7. Verify Azure Key Vault has purge protection enabled per SC-12.
8. Record evidence (configuration state, test results, reviewer).

## Verification Commands

### AC-17/IA-2/IA-5: Remote Access and Authentication (TL-NINFRA-004)

```bash
# Verify SSH configuration meets NIST requirements
grep -E "^(PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|Protocol|MaxAuthTries|X11Forwarding|AllowTcpForwarding)" /etc/ssh/sshd_config

# Verify SSH is using NIST-approved ciphers
sshd -T | grep -E "^(ciphers|macs|kexalgorithms)"

# Verify SSH service status
systemctl status ssh
```

### SC-7: Boundary Protection (TL-NNET-003, TL-NNET-004)

```bash
# Verify UFW boundary protection
sudo ufw status verbose

# Verify default policies
sudo ufw status | grep -E "^Default:"

# List all rules with numbers
sudo ufw status numbered

# Verify Hetzner firewall via Terraform state
terraform show -json | jq '.values.root_module.resources[] | select(.type == "hcloud_firewall") | .values'
```

### SC-5/SI-16: DoS Protection and Memory Protection (TL-NKERN-001)

```bash
# Verify SC-5 DoS protection parameters
sysctl net.ipv4.tcp_syncookies
sysctl net.ipv4.conf.all.rp_filter
sysctl net.ipv4.icmp_echo_ignore_broadcasts

# Verify SI-16 memory protection parameters
sysctl kernel.randomize_va_space
sysctl kernel.kptr_restrict
sysctl kernel.yama.ptrace_scope
sysctl kernel.dmesg_restrict

# Verify sysctl configuration file
cat /etc/sysctl.d/99-security-hardening.conf
```

### AC-7: Unsuccessful Logon Attempts (TL-NAUTH-001)

```bash
# Verify fail2ban service status
systemctl status fail2ban

# Verify SSH jail is active per AC-7
sudo fail2ban-client status sshd

# Check current ban statistics
sudo fail2ban-client status sshd | grep -E "(Currently banned|Total banned)"

# View fail2ban jail configuration
cat /etc/fail2ban/jail.d/sshd.conf
```

### AC-6: Least Privilege (TL-NSVC-001, TL-NSVC-002)

```bash
# Verify API service runs with least privilege
systemctl show tearleads-api --property=User,Group,NoNewPrivileges,ProtectSystem,ProtectHome,PrivateTmp,PrivateDevices,RestrictNamespaces

# Verify SMTP service runs with least privilege
systemctl show tearleads-smtp-listener --property=User,Group,NoNewPrivileges,ProtectSystem,AmbientCapabilities

# Get systemd security score (should be low/safe)
systemd-analyze security tearleads-api
systemd-analyze security tearleads-smtp-listener
```

### SC-12: Cryptographic Key Management (TL-NCRYPTO-005)

```bash
# Verify Key Vault settings via Terraform state
terraform show -json | jq '.values.root_module.resources[] | select(.type == "azurerm_key_vault") | {purge_protection: .values.purge_protection_enabled, soft_delete_days: .values.soft_delete_retention_days, sku: .values.sku_name}'

# Or via Azure CLI
az keyvault show --name <vault-name> --query "{purgeProtection:properties.enablePurgeProtection, softDeleteRetention:properties.softDeleteRetentionInDays, sku:properties.sku.name}"
```

## Evidence Template

- Review date:
- Reviewer:
- Ansible playbook commit SHA:
- Terraform state version:
- Controls verified:
  - AC-17, IA-2, IA-5: `TL-NINFRA-004`
  - SC-7: `TL-NNET-003`, `TL-NNET-004`
  - SC-5, SI-16: `TL-NKERN-001`
  - AC-7: `TL-NAUTH-001`
  - AC-6: `TL-NSVC-001`, `TL-NSVC-002`
  - SC-12: `TL-NCRYPTO-005`
- Verification commands run:
- Configuration state summary:
  - SSH hardening (AC-17/IA-2/IA-5): [PASS/FAIL]
  - UFW firewall (SC-7): [PASS/FAIL]
  - Hetzner firewall (SC-7): [PASS/FAIL]
  - Kernel hardening (SC-5/SI-16): [PASS/FAIL]
  - Fail2ban (AC-7): [PASS/FAIL]
  - Service sandboxing (AC-6): [PASS/FAIL]
  - Key Vault protection (SC-12): [PASS/FAIL]
- Exceptions or remediation tasks:
