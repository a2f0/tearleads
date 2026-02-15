# Infrastructure Security Policy (NIST SP 800-53)

<!-- COMPLIANCE_SENTINEL: TL-NINFRA-004 | policy=compliance/NIST.SP.800-53/policies/04-infrastructure-security-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-infrastructure-security-procedure.md | control=ssh-hardening -->
<!-- COMPLIANCE_SENTINEL: TL-NNET-003 | policy=compliance/NIST.SP.800-53/policies/04-infrastructure-security-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-infrastructure-security-procedure.md | control=host-firewall -->
<!-- COMPLIANCE_SENTINEL: TL-NNET-004 | policy=compliance/NIST.SP.800-53/policies/04-infrastructure-security-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-infrastructure-security-procedure.md | control=infrastructure-firewall -->
<!-- COMPLIANCE_SENTINEL: TL-NKERN-001 | policy=compliance/NIST.SP.800-53/policies/04-infrastructure-security-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-infrastructure-security-procedure.md | control=kernel-hardening -->
<!-- COMPLIANCE_SENTINEL: TL-NAUTH-001 | policy=compliance/NIST.SP.800-53/policies/04-infrastructure-security-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-infrastructure-security-procedure.md | control=brute-force-protection -->
<!-- COMPLIANCE_SENTINEL: TL-NSVC-001 | policy=compliance/NIST.SP.800-53/policies/04-infrastructure-security-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-infrastructure-security-procedure.md | control=api-service-sandboxing -->
<!-- COMPLIANCE_SENTINEL: TL-NSVC-002 | policy=compliance/NIST.SP.800-53/policies/04-infrastructure-security-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-infrastructure-security-procedure.md | control=smtp-service-sandboxing -->
<!-- COMPLIANCE_SENTINEL: TL-NCRYPTO-005 | policy=compliance/NIST.SP.800-53/policies/04-infrastructure-security-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-infrastructure-security-procedure.md | control=key-vault-protection -->

## Purpose

Define mandatory controls for infrastructure security hardening aligned with NIST SP 800-53 Revision 5 requirements across Access Control (AC), System and Communications Protection (SC), and System and Information Integrity (SI) control families. This policy establishes requirements for SSH configuration, firewall rules, kernel security parameters, service isolation, and cryptographic key protection.

## Scope

1. SSH server hardening and authentication controls (AC-17, IA-2, IA-5).
2. Host-level firewall configuration (SC-7).
3. Infrastructure-level firewall configuration (SC-7).
4. Linux kernel security parameters (SC-5, SI-16).
5. Brute-force attack mitigation (AC-7).
6. Application service sandboxing (SC-7, AC-6).
7. Cryptographic key management protection (SC-12).

## Policy Control Index

1. `IS-01` Remote access security via SSH hardening (AC-17, IA-2, IA-5) (`TL-NINFRA-004`).
2. `IS-02` Host boundary protection via UFW firewall (SC-7) (`TL-NNET-003`).
3. `IS-03` Infrastructure boundary protection via cloud firewall (SC-7) (`TL-NNET-004`).
4. `IS-04` Denial-of-service and memory protection via kernel hardening (SC-5, SI-16) (`TL-NKERN-001`).
5. `IS-05` Unsuccessful logon attempt handling via fail2ban (AC-7) (`TL-NAUTH-001`).
6. `IS-06` Least privilege and isolation for API service (SC-7, AC-6) (`TL-NSVC-001`).
7. `IS-07` Least privilege and isolation for SMTP service (SC-7, AC-6) (`TL-NSVC-002`).
8. `IS-08` Cryptographic key protection via Key Vault (SC-12) (`TL-NCRYPTO-005`).

## Roles and Responsibilities

1. Security Owner maintains this policy, approves exceptions, and reviews control evidence.
2. Infrastructure leads implement and maintain hardening configuration in Ansible and Terraform.
3. Operations personnel monitor firewall logs and fail2ban statistics.
4. Compliance owners retain evidence artifacts and conduct periodic security assessments.

## Policy Statements

### AC-17: Remote Access

- Remote access must be controlled through managed access control points (`IS-01`, `TL-NINFRA-004`).
- SSH must use Protocol 2 only; legacy protocols are prohibited (`IS-01`).
- SSH root login must be disabled; all access must use non-root accounts (`IS-01`).
- Remote access sessions must timeout after inactivity (300 seconds with 2 keepalive attempts) (`IS-01`).
- Unnecessary remote access features must be disabled (X11 forwarding, TCP forwarding) (`IS-01`).

### IA-2: Identification and Authentication (Organizational Users)

- Users must be uniquely identified and authenticated for remote access (`IS-01`, `TL-NINFRA-004`).
- Multi-factor or strong authentication must be used (SSH keys are considered strong) (`IS-01`).

### IA-5: Authenticator Management

- SSH password authentication must be disabled; key-based authentication is mandatory (`IS-01`, `TL-NINFRA-004`).
- SSH must use modern cryptographic algorithms (curve25519, chacha20-poly1305, aes256-gcm) (`IS-01`).

### SC-7: Boundary Protection

- System boundary must be protected by monitoring and controlling communications (`IS-02`, `IS-03`, `TL-NNET-003`, `TL-NNET-004`).
- Host firewalls must implement default-deny for incoming traffic (`IS-02`).
- Only explicitly required ports may be opened (SSH:22, HTTP:80, HTTPS:443, SMTP:25) (`IS-02`).
- Infrastructure-level firewalls must mirror host firewall rules for defense-in-depth (`IS-03`).
- Firewall rules must be version-controlled in infrastructure-as-code (`IS-02`, `IS-03`).

### SC-5: Denial-of-Service Protection

- System must protect against denial-of-service attacks (`IS-04`, `TL-NKERN-001`).
- TCP SYN cookies must be enabled for SYN flood protection (`IS-04`).
- IP source routing must be disabled to prevent routing manipulation (`IS-04`).
- ICMP redirects must be ignored to prevent MITM attacks (`IS-04`).
- Reverse path filtering must be enabled to prevent IP spoofing (`IS-04`).

### SI-16: Memory Protection

- Address Space Layout Randomization (ASLR) must be enabled (`IS-04`, `TL-NKERN-001`).
- Kernel pointer exposure must be restricted to prevent address leaks (`IS-04`).
- Ptrace access must be restricted to prevent debugging-based exploits (`IS-04`).
- Services must implement memory protections (MemoryDenyWriteExecute) (`IS-06`, `IS-07`).

### AC-7: Unsuccessful Logon Attempts

- System must limit consecutive invalid logon attempts (`IS-05`, `TL-NAUTH-001`).
- Failed SSH authentication attempts must trigger progressive banning (`IS-05`).
- Ban duration must increase with repeated offenses (starting at 1 hour, maximum 1 week) (`IS-05`).
- Account lockout must integrate with host firewall (UFW) (`IS-05`).

### AC-6: Least Privilege

- Application services must run as non-root users (`IS-06`, `IS-07`, `TL-NSVC-001`, `TL-NSVC-002`).
- Services must have minimum necessary privileges and capabilities (`IS-06`, `IS-07`).
- Services must use systemd sandboxing (NoNewPrivileges, ProtectSystem, PrivateTmp) (`IS-06`, `IS-07`).
- Services requiring privileged ports must use capability-based binding (CAP_NET_BIND_SERVICE) (`IS-07`).

### SC-12: Cryptographic Key Establishment and Management

- Cryptographic keys must be protected from unauthorized access (`IS-08`, `TL-NCRYPTO-005`).
- Key Vault soft-delete must be enabled with minimum 90-day retention (`IS-08`).
- Key Vault purge protection must be enabled to prevent accidental key destruction (`IS-08`).
- Terraform must not purge soft-deleted vaults on destroy (`IS-08`).

## Control Baselines

1. Implemented baseline control: SSH hardening via Ansible template (AC-17, IA-2, IA-5) (`TL-NINFRA-004`).
2. Implemented baseline control: UFW firewall with default-deny (SC-7) (`TL-NNET-003`).
3. Implemented baseline control: Hetzner Cloud firewall with explicit rules (SC-7) (`TL-NNET-004`).
4. Implemented baseline control: sysctl kernel hardening parameters (SC-5, SI-16) (`TL-NKERN-001`).
5. Implemented baseline control: fail2ban SSH jail with progressive bans (AC-7) (`TL-NAUTH-001`).
6. Implemented baseline control: API service systemd sandboxing (SC-7, AC-6) (`TL-NSVC-001`).
7. Implemented baseline control: SMTP service systemd sandboxing (SC-7, AC-6) (`TL-NSVC-002`).
8. Implemented baseline control: Key Vault purge protection (SC-12) (`TL-NCRYPTO-005`).
9. Program baseline expansion target: implement SI-4 (system monitoring with IDS).
10. Program baseline expansion target: implement SI-7 (file integrity monitoring).

## Framework Mapping

| Sentinel | NIST SP 800-53 | SOC2 TSC | Control Outcome |
| --- | --- | --- | --- |
| `TL-NINFRA-004` | AC-17, IA-2, IA-5 | CC6.1, CC6.6 | SSH access is hardened with key-only auth and modern crypto. |
| `TL-NNET-003` | SC-7 | CC6.1, CC6.6 | Host firewall implements default-deny with explicit allows. |
| `TL-NNET-004` | SC-7 | CC6.1, CC6.6 | Infrastructure firewall provides defense-in-depth. |
| `TL-NKERN-001` | SC-5, SI-16 | CC6.1 | Kernel hardening prevents spoofing and memory attacks. |
| `TL-NAUTH-001` | AC-7 | CC6.1 | Brute-force attacks are mitigated with progressive bans. |
| `TL-NSVC-001` | SC-7, AC-6 | CC6.1 | API service runs in isolated sandbox with least privilege. |
| `TL-NSVC-002` | SC-7, AC-6 | CC6.1 | SMTP service runs in isolated sandbox with capability binding. |
| `TL-NCRYPTO-005` | SC-12 | CC6.7 | Cryptographic keys are protected from accidental deletion. |
