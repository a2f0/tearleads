# Infrastructure Security Policy (SOC2)

<!-- COMPLIANCE_SENTINEL: TL-INFRA-004 | policy=compliance/SOC2/policies/04-infrastructure-security-policy.md | procedure=compliance/SOC2/procedures/04-infrastructure-security-procedure.md | control=ssh-hardening -->
<!-- COMPLIANCE_SENTINEL: TL-NET-003 | policy=compliance/SOC2/policies/04-infrastructure-security-policy.md | procedure=compliance/SOC2/procedures/04-infrastructure-security-procedure.md | control=host-firewall -->
<!-- COMPLIANCE_SENTINEL: TL-NET-004 | policy=compliance/SOC2/policies/04-infrastructure-security-policy.md | procedure=compliance/SOC2/procedures/04-infrastructure-security-procedure.md | control=infrastructure-firewall -->
<!-- COMPLIANCE_SENTINEL: TL-KERN-001 | policy=compliance/SOC2/policies/04-infrastructure-security-policy.md | procedure=compliance/SOC2/procedures/04-infrastructure-security-procedure.md | control=kernel-hardening -->
<!-- COMPLIANCE_SENTINEL: TL-AUTH-001 | policy=compliance/SOC2/policies/04-infrastructure-security-policy.md | procedure=compliance/SOC2/procedures/04-infrastructure-security-procedure.md | control=brute-force-protection -->
<!-- COMPLIANCE_SENTINEL: TL-SVC-001 | policy=compliance/SOC2/policies/04-infrastructure-security-policy.md | procedure=compliance/SOC2/procedures/04-infrastructure-security-procedure.md | control=api-service-sandboxing -->
<!-- COMPLIANCE_SENTINEL: TL-SVC-002 | policy=compliance/SOC2/policies/04-infrastructure-security-policy.md | procedure=compliance/SOC2/procedures/04-infrastructure-security-procedure.md | control=smtp-service-sandboxing -->
<!-- COMPLIANCE_SENTINEL: TL-CRYPTO-005 | policy=compliance/SOC2/policies/04-infrastructure-security-policy.md | procedure=compliance/SOC2/procedures/04-infrastructure-security-procedure.md | control=key-vault-protection -->

## Purpose

Define mandatory controls for infrastructure security hardening to protect against unauthorized access, privilege escalation, and network-based attacks. This policy establishes requirements for SSH configuration, firewall rules, kernel security parameters, service isolation, and cryptographic key protection.

## Scope

1. SSH server hardening and authentication controls.
2. Host-level firewall (UFW) configuration.
3. Infrastructure-level firewall (Hetzner Cloud) configuration.
4. Linux kernel security parameters (sysctl).
5. Brute-force attack mitigation (fail2ban).
6. Application service sandboxing (systemd).
7. Cryptographic key management protection (Azure Key Vault).

## Policy Control Index

1. `IS-01` SSH hardening with key-only authentication and modern cryptography (`TL-INFRA-004`).
2. `IS-02` Host firewall with default-deny incoming policy (`TL-NET-003`).
3. `IS-03` Infrastructure firewall with explicit port allowlisting (`TL-NET-004`).
4. `IS-04` Kernel security parameters for network and memory protection (`TL-KERN-001`).
5. `IS-05` Brute-force protection with progressive banning (`TL-AUTH-001`).
6. `IS-06` API service sandboxing with namespace and syscall restrictions (`TL-SVC-001`).
7. `IS-07` SMTP service sandboxing with capability-based port binding (`TL-SVC-002`).
8. `IS-08` Key Vault purge protection and soft-delete recovery (`TL-CRYPTO-005`).

## Roles and Responsibilities

1. Security Owner maintains this policy, approves exceptions, and reviews control evidence.
2. Infrastructure leads implement and maintain hardening configuration in Ansible and Terraform.
3. Operations personnel monitor firewall logs and fail2ban statistics.
4. Compliance owners retain evidence artifacts and conduct periodic security reviews.

## Policy Statements

### Remote Access Security

- SSH must use Protocol 2 only; legacy protocols are prohibited (`IS-01`, `TL-INFRA-004`).
- SSH root login must be disabled; all access must use non-root accounts (`IS-01`, `TL-INFRA-004`).
- SSH password authentication must be disabled; key-based authentication is mandatory (`IS-01`, `TL-INFRA-004`).
- SSH must use modern cryptographic algorithms (curve25519, chacha20-poly1305, aes256-gcm) (`IS-01`, `TL-INFRA-004`).
- SSH authentication attempts must be rate-limited (maximum 3 attempts per connection) (`IS-01`, `TL-INFRA-004`).
- SSH sessions must timeout after inactivity (300 seconds with 2 keepalive attempts) (`IS-01`, `TL-INFRA-004`).
- Unnecessary SSH features must be disabled (X11 forwarding, TCP forwarding, agent forwarding) (`IS-01`, `TL-INFRA-004`).

### Network Security

- Host firewalls must implement default-deny for incoming traffic (`IS-02`, `TL-NET-003`).
- Only explicitly required ports may be opened (SSH:22, HTTP:80, HTTPS:443, SMTP:25) (`IS-02`, `TL-NET-003`).
- Infrastructure-level firewalls must mirror host firewall rules for defense-in-depth (`IS-03`, `TL-NET-004`).
- Firewall rules must be version-controlled in infrastructure-as-code (`IS-02`, `IS-03`).

### Kernel Hardening

- Address Space Layout Randomization (ASLR) must be enabled (`IS-04`, `TL-KERN-001`).
- IP source routing must be disabled to prevent routing manipulation (`IS-04`, `TL-KERN-001`).
- ICMP redirects must be ignored to prevent MITM attacks (`IS-04`, `TL-KERN-001`).
- Reverse path filtering must be enabled to prevent IP spoofing (`IS-04`, `TL-KERN-001`).
- TCP SYN cookies must be enabled for SYN flood protection (`IS-04`, `TL-KERN-001`).
- Kernel pointer exposure must be restricted to prevent address leaks (`IS-04`, `TL-KERN-001`).
- Ptrace access must be restricted to prevent debugging-based exploits (`IS-04`, `TL-KERN-001`).

### Authentication Protection

- Failed SSH authentication attempts must trigger progressive banning (`IS-05`, `TL-AUTH-001`).
- Ban duration must increase with repeated offenses (starting at 1 hour, maximum 1 week) (`IS-05`, `TL-AUTH-001`).
- Fail2ban must integrate with UFW for consistent enforcement (`IS-05`, `TL-AUTH-001`).

### Service Isolation

- Application services must run as non-root users (`IS-06`, `IS-07`, `TL-SVC-001`, `TL-SVC-002`).
- Services must use systemd sandboxing (NoNewPrivileges, ProtectSystem, PrivateTmp) (`IS-06`, `IS-07`).
- Services must have restricted namespace access (RestrictNamespaces) (`IS-06`, `IS-07`).
- Services must have syscall filtering to limit kernel interface exposure (`IS-06`, `IS-07`).
- Services requiring privileged ports must use capability-based binding (CAP_NET_BIND_SERVICE) (`IS-07`, `TL-SVC-002`).

### Cryptographic Protection

- Key Vault soft-delete must be enabled with minimum 90-day retention (`IS-08`, `TL-CRYPTO-005`).
- Key Vault purge protection must be enabled to prevent accidental key destruction (`IS-08`, `TL-CRYPTO-005`).
- Terraform must not purge soft-deleted vaults on destroy (`IS-08`, `TL-CRYPTO-005`).

## Control Baselines

1. Implemented baseline control: SSH hardening via Ansible template (`TL-INFRA-004`).
2. Implemented baseline control: UFW firewall with default-deny (`TL-NET-003`).
3. Implemented baseline control: Hetzner Cloud firewall with explicit rules (`TL-NET-004`).
4. Implemented baseline control: sysctl kernel hardening parameters (`TL-KERN-001`).
5. Implemented baseline control: fail2ban SSH jail with progressive bans (`TL-AUTH-001`).
6. Implemented baseline control: API service systemd sandboxing (`TL-SVC-001`).
7. Implemented baseline control: SMTP service systemd sandboxing (`TL-SVC-002`).
8. Implemented baseline control: Key Vault purge protection (`TL-CRYPTO-005`).
9. Program baseline expansion target: implement intrusion detection system (IDS).
10. Program baseline expansion target: implement file integrity monitoring (FIM).

## Framework Mapping

| Sentinel | SOC2 TSC | NIST SP 800-53 | Control Outcome |
| --- | --- | --- | --- |
| `TL-INFRA-004` | CC6.1, CC6.6 | AC-17, IA-2, IA-5 | SSH access is hardened with key-only auth and modern crypto. |
| `TL-NET-003` | CC6.1, CC6.6 | SC-7 | Host firewall implements default-deny with explicit allows. |
| `TL-NET-004` | CC6.1, CC6.6 | SC-7 | Infrastructure firewall provides defense-in-depth. |
| `TL-KERN-001` | CC6.1 | SC-5, SI-16 | Kernel hardening prevents spoofing and memory attacks. |
| `TL-AUTH-001` | CC6.1 | AC-7 | Brute-force attacks are mitigated with progressive bans. |
| `TL-SVC-001` | CC6.1 | SC-7, AC-6 | API service runs in isolated sandbox with least privilege. |
| `TL-SVC-002` | CC6.1 | SC-7, AC-6 | SMTP service runs in isolated sandbox with capability binding. |
| `TL-CRYPTO-005` | CC6.7 | SC-12 | Cryptographic keys are protected from accidental deletion. |
