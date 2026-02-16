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

## Review Checklist for Routes

- [ ] Authentication check present
- [ ] Authorization check for user role
- [ ] Ownership verification for resource access
- [ ] Input validation before database operations
- [ ] Parameterized queries only
