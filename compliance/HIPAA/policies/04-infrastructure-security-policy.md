# Infrastructure Security Policy (HIPAA)

<!-- COMPLIANCE_SENTINEL: TL-HINFRA-004 | policy=compliance/HIPAA/policies/04-infrastructure-security-policy.md | procedure=compliance/HIPAA/procedures/04-infrastructure-security-procedure.md | control=ssh-hardening -->
<!-- COMPLIANCE_SENTINEL: TL-HNET-003 | policy=compliance/HIPAA/policies/04-infrastructure-security-policy.md | procedure=compliance/HIPAA/procedures/04-infrastructure-security-procedure.md | control=host-firewall -->
<!-- COMPLIANCE_SENTINEL: TL-HNET-004 | policy=compliance/HIPAA/policies/04-infrastructure-security-policy.md | procedure=compliance/HIPAA/procedures/04-infrastructure-security-procedure.md | control=infrastructure-firewall -->
<!-- COMPLIANCE_SENTINEL: TL-HKERN-001 | policy=compliance/HIPAA/policies/04-infrastructure-security-policy.md | procedure=compliance/HIPAA/procedures/04-infrastructure-security-procedure.md | control=kernel-hardening -->
<!-- COMPLIANCE_SENTINEL: TL-HAUTH-001 | policy=compliance/HIPAA/policies/04-infrastructure-security-policy.md | procedure=compliance/HIPAA/procedures/04-infrastructure-security-procedure.md | control=brute-force-protection -->
<!-- COMPLIANCE_SENTINEL: TL-HSVC-001 | policy=compliance/HIPAA/policies/04-infrastructure-security-policy.md | procedure=compliance/HIPAA/procedures/04-infrastructure-security-procedure.md | control=api-service-sandboxing -->
<!-- COMPLIANCE_SENTINEL: TL-HSVC-002 | policy=compliance/HIPAA/policies/04-infrastructure-security-policy.md | procedure=compliance/HIPAA/procedures/04-infrastructure-security-procedure.md | control=smtp-service-sandboxing -->
<!-- COMPLIANCE_SENTINEL: TL-HCRYPTO-005 | policy=compliance/HIPAA/policies/04-infrastructure-security-policy.md | procedure=compliance/HIPAA/procedures/04-infrastructure-security-procedure.md | control=key-vault-protection -->

## Purpose

Define mandatory controls for infrastructure security hardening aligned with HIPAA Security Rule requirements for protecting electronic protected health information (ePHI). This policy establishes requirements for SSH configuration, firewall rules, kernel security parameters, service isolation, and cryptographic key protection.

## Regulatory Authority

- **45 CFR 164.312(a)(1)** - Access Control (Technical Safeguard - Required)
- **45 CFR 164.312(d)** - Person or Entity Authentication (Technical Safeguard - Required)
- **45 CFR 164.312(e)(1)** - Transmission Security (Technical Safeguard - Required)
- **45 CFR 164.312(a)(2)(iv)** - Encryption and Decryption (Technical Safeguard - Addressable)
- **45 CFR 164.312(a)(2)(iii)** - Automatic Logoff (Technical Safeguard - Addressable)

## Scope

1. SSH server hardening and authentication controls (164.312(d)).
2. Host-level firewall configuration (164.312(e)(1)).
3. Infrastructure-level firewall configuration (164.312(e)(1)).
4. Linux kernel security parameters.
5. Brute-force attack mitigation (164.312(d)).
6. Application service isolation (164.312(a)(1)).
7. Cryptographic key protection (164.312(a)(2)(iv)).

## Policy Control Index

1. `IS-01` Person/entity authentication via SSH hardening (164.312(d)) (`TL-HINFRA-004`).
2. `IS-02` Transmission security via host firewall (164.312(e)(1)) (`TL-HNET-003`).
3. `IS-03` Transmission security via infrastructure firewall (164.312(e)(1)) (`TL-HNET-004`).
4. `IS-04` System integrity via kernel hardening (`TL-HKERN-001`).
5. `IS-05` Authentication protection via fail2ban (164.312(d)) (`TL-HAUTH-001`).
6. `IS-06` Access control for API service (164.312(a)(1)) (`TL-HSVC-001`).
7. `IS-07` Access control for SMTP service (164.312(a)(1)) (`TL-HSVC-002`).
8. `IS-08` Encryption key management (164.312(a)(2)(iv)) (`TL-HCRYPTO-005`).

## Roles and Responsibilities

1. Security Officer maintains this policy, approves exceptions, and reviews control evidence.
2. Infrastructure leads implement and maintain hardening configuration in Ansible and Terraform.
3. Operations personnel monitor firewall logs and authentication failures.
4. Compliance owners retain evidence artifacts and conduct periodic security evaluations.

## Policy Statements

### 164.312(d) Person or Entity Authentication

- Users must be uniquely identified and authenticated before accessing ePHI systems (`IS-01`, `TL-HINFRA-004`).
- SSH must use strong authentication (public key cryptography) (`IS-01`).
- SSH password authentication must be disabled; key-based authentication is mandatory (`IS-01`).
- SSH must use modern cryptographic algorithms (curve25519, chacha20-poly1305, aes256-gcm) (`IS-01`).
- Authentication attempts must be rate-limited (maximum 3 attempts per connection) (`IS-01`).
- Failed authentication attempts must trigger progressive account lockout (`IS-05`, `TL-HAUTH-001`).
- Lockout must integrate with network controls (UFW) for comprehensive protection (`IS-05`).

### 164.312(a)(2)(iii) Automatic Logoff

- SSH sessions must timeout after inactivity (300 seconds with 2 keepalive attempts) (`IS-01`, `TL-HINFRA-004`).
- Unnecessary session features must be disabled (X11 forwarding, TCP forwarding) (`IS-01`).

### 164.312(e)(1) Transmission Security

- Systems containing ePHI must implement security measures to guard against unauthorized access during transmission (`IS-02`, `IS-03`, `TL-HNET-003`, `TL-HNET-004`).
- Host firewalls must implement default-deny for incoming traffic (`IS-02`).
- Only explicitly required ports may be opened (SSH:22, HTTP:80, HTTPS:443, SMTP:25) (`IS-02`).
- Infrastructure-level firewalls must mirror host firewall rules for defense-in-depth (`IS-03`).
- Firewall rules must be version-controlled in infrastructure-as-code (`IS-02`, `IS-03`).

### 164.312(a)(1) Access Control

- Application services must implement technical policies to allow access only to authorized persons (`IS-06`, `IS-07`, `TL-HSVC-001`, `TL-HSVC-002`).
- Services must run as non-root users with minimum necessary privileges (`IS-06`, `IS-07`).
- Services must use systemd sandboxing (NoNewPrivileges, ProtectSystem, PrivateTmp) (`IS-06`, `IS-07`).
- Services must have restricted namespace access and syscall filtering (`IS-06`, `IS-07`).
- Services requiring privileged ports must use capability-based binding (`IS-07`).

### 164.312(a)(2)(iv) Encryption and Decryption

- Cryptographic keys must be protected from unauthorized access (`IS-08`, `TL-HCRYPTO-005`).
- Key Vault soft-delete must be enabled with minimum 90-day retention (`IS-08`).
- Key Vault purge protection must be enabled to prevent accidental key destruction (`IS-08`).

### System Integrity

- Kernel hardening must protect against network-based attacks (`IS-04`, `TL-HKERN-001`).
- Address Space Layout Randomization (ASLR) must be enabled (`IS-04`).
- IP source routing must be disabled to prevent routing manipulation (`IS-04`).
- ICMP redirects must be ignored to prevent MITM attacks (`IS-04`).
- TCP SYN cookies must be enabled for denial-of-service protection (`IS-04`).

## Control Baselines

1. Implemented baseline control: SSH hardening via Ansible template (164.312(d)) (`TL-HINFRA-004`).
2. Implemented baseline control: UFW firewall with default-deny (164.312(e)(1)) (`TL-HNET-003`).
3. Implemented baseline control: Hetzner Cloud firewall (164.312(e)(1)) (`TL-HNET-004`).
4. Implemented baseline control: sysctl kernel hardening parameters (`TL-HKERN-001`).
5. Implemented baseline control: fail2ban SSH jail (164.312(d)) (`TL-HAUTH-001`).
6. Implemented baseline control: API service systemd sandboxing (164.312(a)(1)) (`TL-HSVC-001`).
7. Implemented baseline control: SMTP service systemd sandboxing (164.312(a)(1)) (`TL-HSVC-002`).
8. Implemented baseline control: Key Vault purge protection (164.312(a)(2)(iv)) (`TL-HCRYPTO-005`).
9. Program baseline expansion target: implement intrusion detection for ePHI systems.

## Framework Mapping

| Sentinel | HIPAA Security Rule | NIST SP 800-53 | Control Outcome |
| --- | --- | --- | --- |
| `TL-HINFRA-004` | 164.312(d), 164.312(a)(2)(iii) | AC-17, IA-2, IA-5 | SSH access is hardened with key-only auth and session timeout. |
| `TL-HNET-003` | 164.312(e)(1) | SC-7 | Host firewall implements default-deny with explicit allows. |
| `TL-HNET-004` | 164.312(e)(1) | SC-7 | Infrastructure firewall provides defense-in-depth. |
| `TL-HKERN-001` | - | SC-5, SI-16 | Kernel hardening prevents network attacks. |
| `TL-HAUTH-001` | 164.312(d) | AC-7 | Brute-force attacks are mitigated with progressive lockout. |
| `TL-HSVC-001` | 164.312(a)(1) | SC-7, AC-6 | API service runs with access controls and isolation. |
| `TL-HSVC-002` | 164.312(a)(1) | SC-7, AC-6 | SMTP service runs with access controls and isolation. |
| `TL-HCRYPTO-005` | 164.312(a)(2)(iv) | SC-12 | Cryptographic keys are protected from accidental deletion. |
