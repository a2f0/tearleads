# Infrastructure Security Procedure (HIPAA)

<!-- COMPLIANCE_SENTINEL: TL-HINFRA-004 | policy=compliance/HIPAA/policies/04-infrastructure-security-policy.md | procedure=compliance/HIPAA/procedures/04-infrastructure-security-procedure.md | control=ssh-hardening -->
<!-- COMPLIANCE_SENTINEL: TL-HNET-003 | policy=compliance/HIPAA/policies/04-infrastructure-security-policy.md | procedure=compliance/HIPAA/procedures/04-infrastructure-security-procedure.md | control=host-firewall -->
<!-- COMPLIANCE_SENTINEL: TL-HNET-004 | policy=compliance/HIPAA/policies/04-infrastructure-security-policy.md | procedure=compliance/HIPAA/procedures/04-infrastructure-security-procedure.md | control=infrastructure-firewall -->
<!-- COMPLIANCE_SENTINEL: TL-HKERN-001 | policy=compliance/HIPAA/policies/04-infrastructure-security-policy.md | procedure=compliance/HIPAA/procedures/04-infrastructure-security-procedure.md | control=kernel-hardening -->
<!-- COMPLIANCE_SENTINEL: TL-HAUTH-001 | policy=compliance/HIPAA/policies/04-infrastructure-security-policy.md | procedure=compliance/HIPAA/procedures/04-infrastructure-security-procedure.md | control=brute-force-protection -->
<!-- COMPLIANCE_SENTINEL: TL-HSVC-001 | policy=compliance/HIPAA/policies/04-infrastructure-security-policy.md | procedure=compliance/HIPAA/procedures/04-infrastructure-security-procedure.md | control=api-service-sandboxing -->
<!-- COMPLIANCE_SENTINEL: TL-HSVC-002 | policy=compliance/HIPAA/policies/04-infrastructure-security-policy.md | procedure=compliance/HIPAA/procedures/04-infrastructure-security-procedure.md | control=smtp-service-sandboxing -->
<!-- COMPLIANCE_SENTINEL: TL-HCRYPTO-005 | policy=compliance/HIPAA/policies/04-infrastructure-security-policy.md | procedure=compliance/HIPAA/procedures/04-infrastructure-security-procedure.md | control=key-vault-protection -->

## Frequency

- Execute at least annually per 164.308(a)(8) (Evaluation) requirements.
- Execute after any infrastructure change that affects security configuration.
- Execute after any Ansible playbook or Terraform deployment that includes security controls.

## Procedure Steps

1. Verify SSH hardening configuration meets 164.312(d) person/entity authentication requirements.
2. Verify UFW firewall is enabled with default-deny policy per 164.312(e)(1).
3. Verify Hetzner Cloud firewall rules match expected configuration per 164.312(e)(1).
4. Verify kernel hardening sysctl parameters are applied.
5. Verify fail2ban is running with SSH jail active per 164.312(d).
6. Verify systemd service sandboxing is applied per 164.312(a)(1).
7. Verify Azure Key Vault has purge protection enabled per 164.312(a)(2)(iv).
8. Record evidence (configuration state, test results, reviewer).

## Verification Commands

### 164.312(d): Person or Entity Authentication (TL-HINFRA-004)

```bash
# Verify SSH authentication configuration
grep -E "^(PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|Protocol|MaxAuthTries)" /etc/ssh/sshd_config

# Verify SSH cryptographic settings
sshd -T | grep -E "^(ciphers|macs|kexalgorithms)"

# Verify SSH service status
systemctl status ssh
```

### 164.312(a)(2)(iii): Automatic Logoff (TL-HINFRA-004)

```bash
# Verify session timeout configuration
grep -E "^(ClientAliveInterval|ClientAliveCountMax)" /etc/ssh/sshd_config
```

### 164.312(e)(1): Transmission Security (TL-HNET-003, TL-HNET-004)

```bash
# Verify UFW firewall status
sudo ufw status verbose

# Verify default policies
sudo ufw status | grep -E "^Default:"

# List all rules
sudo ufw status numbered

# Verify Hetzner firewall via Terraform
terraform show -json | jq '.values.root_module.resources[] | select(.type == "hcloud_firewall") | .values'
```

### Kernel Hardening (TL-HKERN-001)

```bash
# Verify network protection parameters
sysctl net.ipv4.tcp_syncookies
sysctl net.ipv4.conf.all.rp_filter
sysctl net.ipv4.icmp_echo_ignore_broadcasts

# Verify memory protection parameters
sysctl kernel.randomize_va_space
sysctl kernel.kptr_restrict

# Verify configuration file
cat /etc/sysctl.d/99-security-hardening.conf
```

### 164.312(d): Authentication Protection (TL-HAUTH-001)

```bash
# Verify fail2ban service status
systemctl status fail2ban

# Verify SSH jail is active
sudo fail2ban-client status sshd

# Check lockout statistics
sudo fail2ban-client status sshd | grep -E "(Currently banned|Total banned)"

# View jail configuration
cat /etc/fail2ban/jail.d/sshd.conf
```

### 164.312(a)(1): Access Control (TL-HSVC-001, TL-HSVC-002)

```bash
# Verify API service access controls
systemctl show tearleads-api --property=User,Group,NoNewPrivileges,ProtectSystem,ProtectHome,PrivateTmp

# Verify SMTP service access controls
systemctl show tearleads-smtp-listener --property=User,Group,NoNewPrivileges,ProtectSystem,AmbientCapabilities

# Get systemd security analysis
systemd-analyze security tearleads-api
systemd-analyze security tearleads-smtp-listener
```

### 164.312(a)(2)(iv): Encryption (TL-HCRYPTO-005)

```bash
# Verify Key Vault protection via Terraform
terraform show -json | jq '.values.root_module.resources[] | select(.type == "azurerm_key_vault") | {purge_protection: .values.purge_protection_enabled, soft_delete_days: .values.soft_delete_retention_days}'

# Or via Azure CLI
az keyvault show --name <vault-name> --query "{purgeProtection:properties.enablePurgeProtection, softDeleteRetention:properties.softDeleteRetentionInDays}"
```

## Evidence Template

- Review date:
- Reviewer:
- Ansible playbook commit SHA:
- Terraform state version:
- Controls verified:
  - 164.312(d): `TL-HINFRA-004`, `TL-HAUTH-001`
  - 164.312(a)(2)(iii): `TL-HINFRA-004`
  - 164.312(e)(1): `TL-HNET-003`, `TL-HNET-004`
  - 164.312(a)(1): `TL-HSVC-001`, `TL-HSVC-002`
  - 164.312(a)(2)(iv): `TL-HCRYPTO-005`
- Verification commands run:
- Configuration state summary:
  - SSH hardening (164.312(d)): [PASS/FAIL]
  - Session timeout (164.312(a)(2)(iii)): [PASS/FAIL]
  - UFW firewall (164.312(e)(1)): [PASS/FAIL]
  - Hetzner firewall (164.312(e)(1)): [PASS/FAIL]
  - Kernel hardening: [PASS/FAIL]
  - Fail2ban (164.312(d)): [PASS/FAIL]
  - Service access control (164.312(a)(1)): [PASS/FAIL]
  - Key Vault protection (164.312(a)(2)(iv)): [PASS/FAIL]
- Exceptions or remediation tasks:
