# Security and Compliance Standards

## Security-First Review

All code changes should be evaluated for security implications. Reviewers must check for OWASP Top 10 vulnerabilities.

## Compliance Documentation Integration

This codebase maintains formal compliance documentation under compliance/ for HIPAA, NIST SP 800-53, and SOC2 frameworks.

## Sentinel System

Security controls are tracked via sentinels with framework-specific prefixes:

| Prefix | Framework | Example |
| --- | --- | --- |
| TL-INFRA-* | Cross-framework infrastructure | TL-INFRA-001 SSH key auth |
| TL-HINFRA-* | HIPAA infrastructure | TL-HINFRA-004 SSH hardening |
| TL-NET-* | Cross-framework network | TL-NET-001 NSG rules |
| TL-CRYPTO-* | Cross-framework crypto | TL-CRYPTO-001 Key Vault RBAC |
| TL-SVC-* | Cross-framework services | TL-SVC-001 API sandboxing |

## OWASP Top 10 Quick Reference

| Vulnerability | What to Flag |
| --- | --- |
| Injection (SQL, Command) | String interpolation in queries, exec() with user input |
| Broken Auth | Missing session validation, weak token handling |
| Sensitive Data Exposure | Logging secrets, returning password hashes |
| XXE | XML parsing without disabling external entities |
| Broken Access Control | Missing ownership checks, IDOR vulnerabilities |
| Security Misconfiguration | Verbose errors in production, default credentials |
| XSS | Unescaped user content in HTML |
| Insecure Deserialization | eval(), or unsafe use of objects from JSON.parse on untrusted data |
| Known Vulnerabilities | Outdated dependencies with CVEs |
| Insufficient Logging | No audit trail for security events |
