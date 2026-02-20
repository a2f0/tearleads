# API Security Standards

## Authorization Hierarchy

```text
Admin > Org Admin > Group Admin > User
```

Every route must verify:

1. **Authentication** - Valid session/token
2. **Authorization** - Permission for the action
3. **Ownership** - Access to the specific resource

## Required Checks

```typescript
// Example: Editing a resource
router.put("/resources/:id", async (req, res) => {
  // 1. Auth check
  const claims = await getAuthClaims(req);
  if (!claims) return res.status(401).json({ error: "Unauthorized" });

  // 2. Ownership check
  const [resource] = await db.select().from(resources).where(eq(resources.id, req.params.id));
  if (!resource || (resource.userId !== claims.userId && !claims.isAdmin)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // 3. Proceed with operation
});
```

## SQL Injection Prevention

```typescript
// GOOD: Parameterized queries
await db.select().from(users).where(eq(users.id, userId));

// BAD: String interpolation
await db.execute(`SELECT * FROM users WHERE id = "${userId}"`);  // NEVER
```

## Input Validation

Validate all inputs at the API boundary before processing:

```typescript
// GOOD: Validate early, fail fast
router.post("/resources", async (req, res) => {
  const { name, email } = req.body;

  // Type checks
  if (typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({ error: "name must be a non-empty string" });
  }

  // Length limits
  if (name.length > 255) {
    return res.status(400).json({ error: "name exceeds maximum length" });
  }

  // Format validation
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  // Proceed with validated data
});

// BAD: Trust user input
router.post("/resources", async (req, res) => {
  await db.insert(resources).values(req.body);  // NEVER
});
```

## Error Responses

Use consistent error response format and appropriate status codes:

```typescript
// Status code guide
// 400 - Bad Request (validation failures, malformed input)
// 401 - Unauthorized (missing or invalid authentication)
// 403 - Forbidden (authenticated but lacks permission)
// 404 - Not Found (resource doesn't exist)
// 409 - Conflict (duplicate resource, state conflict)
// 500 - Internal Server Error (unexpected failures)

// GOOD: Consistent format, no stack traces in production
res.status(400).json({ error: "name must be a non-empty string" });
res.status(401).json({ error: "Unauthorized" });
res.status(403).json({ error: "Forbidden" });

// BAD: Leaking implementation details
res.status(500).json({ error: err.stack });  // NEVER
res.status(400).json({ error: err.message, query: sql });  // NEVER
```

## Secrets Management

Never expose secrets in responses, logs, or error messages:

```typescript
// GOOD: Mask sensitive data in logs
console.log("Auth attempt for user:", userId);

// BAD: Logging secrets
console.log("Using API key:", apiKey);  // NEVER
console.log("JWT token:", token);  // NEVER

// GOOD: Return minimal session info
res.json({ ok: true, expiresAt: session.expiresAt });

// BAD: Returning password hashes or tokens
res.json({ user, passwordHash });  // NEVER
```

## Rate Limiting

Flag routes that handle authentication or sensitive operations without rate limiting:

```typescript
// Sensitive endpoints that MUST have rate limiting:
// - POST /login, /register, /reset-password
// - POST /api/keys (API key generation)
// - Any endpoint accepting file uploads

// Example middleware pattern
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5,  // 5 attempts per window
  message: { error: "Too many login attempts" }
});

router.post("/login", loginLimiter, loginHandler);
```

## CORS and CSRF

Review CORS configuration for overly permissive settings:

```typescript
// BAD: Allow all origins
app.use(cors({ origin: "*" }));  // Flag this

// GOOD: Explicit allowed origins
app.use(cors({
  origin: ["https://app.example.com"],
  credentials: true
}));

// State-changing operations should verify origin/referer
// or use CSRF tokens for browser-based requests
```

## Review Checklist for Routes

- [ ] Authentication check present
- [ ] Authorization check for user role
- [ ] Ownership verification for resource access
- [ ] Input validation before database operations
- [ ] Parameterized queries only
- [ ] Consistent error response format
- [ ] No secrets in logs or error messages
- [ ] Rate limiting on auth/sensitive endpoints
- [ ] CORS configured with explicit origins
