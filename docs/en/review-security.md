# Security and Compliance Review Guidelines

This document provides detailed review guidelines for security and compliance in the Tearleads codebase.

## Security-First Review

All code changes should be evaluated for security implications. Reviewers must check for OWASP Top 10 vulnerabilities including SQL injection, XSS, broken authentication, and insecure direct object references.

## Compliance Documentation Integration

This codebase maintains formal compliance documentation under `compliance/` for HIPAA, NIST SP 800-53, and SOC2 frameworks. Each framework follows a document triad structure:

```text
compliance/
  infrastructure-controls.md    # Cross-framework sentinel mapping
  HIPAA/
    POLICY_INDEX.md             # Framework index
    policies/NN-topic-policy.md
    procedures/NN-topic-procedure.md
    technical-controls/NN-topic-control-map.md
  NIST.SP.800-53/
    (same structure)
  SOC2/
    (same structure)
```

## When Compliance Documentation Updates Are Required

Reviewers should flag PRs that may need compliance documentation updates:

| Change Type | Compliance Action |
| --- | --- |
| New authentication/authorization controls | Add or update account-management triad |
| New audit logging | Add or update audit-logging triad |
| Infrastructure security changes | Update infrastructure-security triad |
| New encryption/key management | Update relevant technical control maps |
| New service sandboxing | Add sentinel to infrastructure-controls.md |

## Sentinel System

Security controls are tracked via sentinels with framework-specific prefixes:

| Prefix | Framework | Example |
| --- | --- | --- |
| `TL-INFRA-*` | Cross-framework infrastructure | `TL-INFRA-001` SSH key auth |
| `TL-HINFRA-*` | HIPAA infrastructure | `TL-HINFRA-004` SSH hardening |
| `TL-NET-*` | Cross-framework network | `TL-NET-001` NSG rules |
| `TL-CRYPTO-*` | Cross-framework crypto | `TL-CRYPTO-001` Key Vault RBAC |
| `TL-SVC-*` | Cross-framework services | `TL-SVC-001` API sandboxing |

## Adding New Sentinels

When adding new security controls:

1. **Define the sentinel ID** following the naming pattern: `TL-<CATEGORY>-<NUMBER>`
2. **Add to cross-framework doc** (`compliance/infrastructure-controls.md`) with location and description
3. **Create/update document triad** in each framework directory
4. **Add COMPLIANCE_SENTINEL comments** in policy documents:

```markdown
<!-- COMPLIANCE_SENTINEL: TL-NEW-001 | policy=path | procedure=path | control=description -->
```

## Review Checklist for Security-Sensitive Changes

- [ ] Authentication check present on new routes
- [ ] Authorization check for user role/permissions
- [ ] Ownership verification for resource access
- [ ] Input validation before database operations
- [ ] Parameterized queries only (no string interpolation)
- [ ] Sensitive data not exposed in responses
- [ ] If new security control: compliance documentation updated
- [ ] If infrastructure change: sentinel added to infrastructure-controls.md

## OWASP Top 10 Quick Reference

| Vulnerability | What to Flag |
| --- | --- |
| Injection (SQL, Command) | String interpolation in queries, `exec()` with user input |
| Broken Auth | Missing session validation, weak token handling |
| Sensitive Data Exposure | Logging secrets, returning password hashes |
| XXE | XML parsing without disabling external entities |
| Broken Access Control | Missing ownership checks, IDOR vulnerabilities |
| Security Misconfiguration | Verbose errors in production, default credentials |
| XSS | Unescaped user content in HTML |
| Insecure Deserialization | `eval()`, or unsafe use of objects from `JSON.parse` on untrusted data (e.g. prototype pollution) |
| Known Vulnerabilities | Outdated dependencies with CVEs |
| Insufficient Logging | No audit trail for security events |
