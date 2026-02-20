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

## Secure Coding Examples

### SQL Injection Prevention

```typescript
// GOOD: Parameterized queries with Drizzle
await db.select().from(users).where(eq(users.id, userId));

// GOOD: Parameterized raw query
await pool.query("SELECT * FROM users WHERE id = $1", [userId]);

// BAD: String interpolation
await pool.query(`SELECT * FROM users WHERE id = '${userId}'`);  // NEVER
```

### Command Injection Prevention

```typescript
// GOOD: Use spawn with argument array
import { spawn } from "child_process";
spawn("git", ["log", "--oneline", branchName]);

// BAD: Shell interpolation
exec(`git log --oneline ${branchName}`);  // NEVER - allows ; rm -rf /
```

### XSS Prevention

```typescript
// GOOD: React auto-escapes by default
<div>{userInput}</div>

// BAD: Bypass React's escaping
<div dangerouslySetInnerHTML={{ __html: userInput }} />  // Flag this

// If HTML is required, sanitize first
import DOMPurify from "dompurify";
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
```

### Sensitive Data Handling

```typescript
// GOOD: Hash passwords with proper algorithm
import bcrypt from "bcrypt";
const hash = await bcrypt.hash(password, 12);

// GOOD: Compare hashes timing-safe
const valid = await bcrypt.compare(password, hash);

// BAD: Storing plaintext passwords
await db.insert(users).values({ password: password });  // NEVER

// BAD: Weak hashing
const hash = crypto.createHash("md5").update(password).digest("hex");  // NEVER
```

### Session Management

```typescript
// GOOD: Secure session cookies
res.cookie("session", token, {
  httpOnly: true,   // Prevent XSS access
  secure: true,     // HTTPS only
  sameSite: "lax",  // CSRF protection
  maxAge: 3600000   // 1 hour expiry
});

// BAD: Insecure cookie settings
res.cookie("session", token);  // Missing security flags
```

### Path Traversal Prevention

```typescript
// GOOD: Validate and resolve paths
import path from "path";

function getFilePath(filename: string): string {
  const safeName = path.basename(filename);  // Remove directory components
  const fullPath = path.join(UPLOAD_DIR, safeName);

  // Verify path is within allowed directory
  if (!fullPath.startsWith(UPLOAD_DIR)) {
    throw new Error("Invalid path");
  }
  return fullPath;
}

// BAD: Trust user-provided paths
const file = path.join(UPLOAD_DIR, req.params.filename);  // Allows ../../../etc/passwd
```

## Environment Variables

Never hardcode secrets:

```typescript
// GOOD: Use environment variables
const apiKey = process.env.API_KEY;
if (!apiKey) throw new Error("API_KEY required");

// BAD: Hardcoded secrets
const apiKey = "sk-1234567890";  // NEVER
```

## Review Checklist

- [ ] No string interpolation in SQL/commands
- [ ] Passwords hashed with bcrypt (cost >= 12)
- [ ] Session cookies have httpOnly, secure, sameSite
- [ ] No dangerouslySetInnerHTML without sanitization
- [ ] Environment variables for all secrets
- [ ] Path inputs validated and bounded
- [ ] No sensitive data in logs or error messages
