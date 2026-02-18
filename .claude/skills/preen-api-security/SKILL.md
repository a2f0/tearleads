---
name: preen-api-security
description: Proactively audit the API for security vulnerabilities, focusing on authorization boundaries, data access controls, and common security issues. Run during security reviews or slack time.
---


# Preen API Security

Proactively audit the API (`packages/api`) for security vulnerabilities, focusing on authorization boundaries, data access controls, and common security issues, including group-scoped authorization where groups are local to an organization and can contain many users.

## Permission Hierarchy

The API enforces the following permission boundaries (highest to lowest):

1. **Admin (Root User)** - Global admin flag (`users.admin = true`). Has access to everything. This is the most protected role.
2. **Org Admin** - Organization-level administrator. Permissions enforced at organization boundary.
3. **Group Scope** - Groups are organization-local collections of users. Group-scoped resources must enforce both organization and group membership boundaries.
4. **Regular User** - Standard user. Permissions enforced at user boundary for data I/O.

## When to Run

Run this skill when:

- Adding new API routes or modifying existing ones
- During security reviews or audits
- Maintaining code quality or during slack time
- After changes to authentication/authorization logic

## Discovery Phase

Search the API for security issues:

```bash
# Find routes that may be missing auth checks
rg -n --glob '*.ts' 'router\.(get|post|put|patch|delete)' packages/api/src/routes | rg -v 'test\.' | head -30

# Find handlers that don't check authClaims
rg -L --glob '*.ts' 'authClaims|req\.session' packages/api/src/routes | rg -v 'index\.ts|shared\.ts|test\.' | head -20

# Find direct database queries that may not filter by user/org/group
rg -n --glob '*.ts' 'pool\.query|client\.query' packages/api/src/routes | rg -v 'WHERE.*user_id|WHERE.*owner_id|WHERE.*organization_id|WHERE.*group_id' | head -20

# Find group-scoped handlers that may miss membership checks
rg -n --glob '*.ts' 'group_id|groups|group_members|group_users' packages/api/src/routes | head -30

# Find admin routes to verify they use adminSessionMiddleware
rg -n --glob '*.ts' '/admin' packages/api/src/routes | head -20

# Find potential SQL injection risks (string concatenation in queries)
rg -n --glob '*.ts' '\`.*\${.*pool\.query|\`.*\${.*client\.query' packages/api/src/routes | head -20

# Find missing input validation (handlers without parseXxxPayload or validation)
rg -L --glob '*.ts' 'parse.*Payload|z\.|isRecord|typeof.*===|validateRequest' packages/api/src/routes | rg -v 'index\.ts|shared\.ts|test\.' | head -20

# Find routes returning raw database results (potential data leakage)
rg -n --glob '*.ts' 'res\.json\(.*rows\[0\]|res\.json\(.*result\.rows' packages/api/src/routes | head -20
```

## Security Audit Categories

### 1. Authorization Boundary Violations

**Admin Routes:**

- All `/admin/*` routes MUST use `adminSessionMiddleware`
- Admin endpoints should not expose sensitive user data (passwords, keys, tokens)
- Verify admin status is checked before any privileged operations

**Organization Boundaries:**

- Users should only access data within their organization(s)
- Queries must filter by `organization_id` when accessing org-scoped data
- Cross-organization data access is a critical vulnerability

**Group Boundaries (Organization-Local):**

- A `group_id` must always resolve to a group inside the requester's organization
- Group-scoped access must verify requester membership in the target group (many users can belong to one group)
- Never trust client-supplied `group_id` without server-side membership verification
- Cross-group access without membership is a critical vulnerability

**User Boundaries:**

- Users should only access their own data (files, settings, conversations)
- Queries must filter by `user_id` or `owner_id` for user-scoped resources
- Check for IDOR (Insecure Direct Object Reference) vulnerabilities

### 2. Authentication Checks

Every non-exempt route must verify:

```typescript
// Required auth check pattern
const claims = req.authClaims;
if (!claims) {
  res.status(401).json({ error: 'Unauthorized' });
  return;
}
const userId = claims.sub;
```

Exempt routes (defined in `middleware/auth.ts`):

- `/ping` - Health check
- `/auth/login`, `/auth/register`, `/auth/refresh`

### 3. Group Membership Verification Pattern

Group-scoped resource access must verify membership and organization scope:

```typescript
const membership = await pool.query(
  `SELECT 1
   FROM groups g
   INNER JOIN group_users gu ON gu.group_id = g.id
   WHERE g.id = $1
     AND g.organization_id = $2
     AND gu.user_id = $3`,
  [groupId, organizationId, claims.sub]
);

if (membership.rows.length === 0) {
  res.status(403).json({ error: 'Forbidden' });
  return;
}
```

### 4. Owner Verification Pattern

Resource access must verify ownership:

```typescript
// Good: Verify requester owns the resource
const result = await pool.query(
  `SELECT owner_id FROM vfs_registry WHERE id = $1`,
  [itemId]
);

if (result.rows[0]?.owner_id !== claims.sub) {
  res.status(403).json({ error: 'Forbidden' });
  return;
}
```

### 5. SQL Injection Prevention

All queries must use parameterized queries:

```typescript
// Bad: String interpolation in queries
const query = `SELECT * FROM users WHERE id = '${userId}'`;

// Good: Parameterized queries
const query = `SELECT * FROM users WHERE id = $1`;
const result = await pool.query(query, [userId]);
```

### 6. Input Validation

All request payloads must be validated:

```typescript
// Good: Strict payload validation
export function parseUserUpdatePayload(body: unknown): UserUpdatePayload | null {
  if (!isRecord(body)) return null;

  // Validate each field with type checks
  if ('email' in body && typeof body.email !== 'string') return null;

  // Return validated payload
}
```

### 7. Data Exposure Prevention

Avoid exposing sensitive fields in responses:

- Never return password hashes
- Never return encryption keys or secrets
- Strip internal fields before sending responses
- Use explicit field selection instead of `SELECT *`

### 8. Session Handling

Verify proper session management:

- Sessions must be validated against Redis store
- Session data should include `userId`, `admin`, `email`
- Token refresh should invalidate old tokens atomically
- Account disable should revoke all sessions

## Prioritization

Fix issues in this order (highest impact first):

1. **Missing auth checks** - Any route without authentication is critical
2. **Admin bypass vulnerabilities** - Non-admins accessing admin routes
3. **Organization boundary violations** - Cross-org data access
4. **Group boundary violations** - Cross-group access or group/org mismatch
5. **User boundary violations (IDOR)** - Accessing other users' data
6. **SQL injection risks** - String concatenation in queries
7. **Missing input validation** - Unparsed request bodies
8. **Data exposure** - Returning sensitive fields
9. **Missing rate limiting** - DoS vulnerabilities

## Workflow

1. **Discovery**: Run discovery commands to identify candidates.
2. **Categorize**: Group issues by severity and category.
3. **Create branch**: `git checkout -b security/api-<area>`
4. **Fix issues**: Apply fixes starting with highest severity.
5. **Add tests**: Write tests for security checks.
6. **Validate**: Run `pnpm --filter @tearleads/api typecheck` and `pnpm --filter @tearleads/api lint`.
7. **Run tests**: Run `pnpm --filter @tearleads/api test`.
8. **Commit and merge**: Run `/commit-and-push`, then `/enter-merge-queue`.

If no security issues were found during discovery, do not create a branch or run commit/merge workflows.

## Fix Patterns

### Adding Owner Verification

```typescript
// Before: No ownership check
export const getItemHandler = async (req: Request<{ id: string }>, res: Response) => {
  const result = await pool.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
  res.json(result.rows[0]);
};

// After: Verify ownership
export const getItemHandler = async (req: Request<{ id: string }>, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const result = await pool.query(
    'SELECT * FROM items WHERE id = $1 AND owner_id = $2',
    [req.params.id, claims.sub]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  res.json(result.rows[0]);
};
```

### Adding Organization Boundary

```typescript
// Before: No org boundary
const result = await pool.query('SELECT * FROM resources');

// After: Filter by user's organizations
const orgResult = await pool.query(
  `SELECT organization_id FROM user_organizations WHERE user_id = $1`,
  [claims.sub]
);
const orgIds = orgResult.rows.map((r) => r.organization_id);

const result = await pool.query(
  `SELECT * FROM resources WHERE organization_id = ANY($1)`,
  [orgIds]
);
```

### Adding Group Boundary

```typescript
// Before: Group ID trusted without membership verification
const result = await pool.query(
  `SELECT * FROM group_resources WHERE group_id = $1`,
  [req.params.groupId]
);

// After: Enforce org + group membership
const membership = await pool.query(
  `SELECT 1
   FROM groups g
   INNER JOIN group_users gu ON gu.group_id = g.id
   WHERE g.id = $1
     AND g.organization_id = $2
     AND gu.user_id = $3`,
  [req.params.groupId, orgId, claims.sub]
);

if (membership.rows.length === 0) {
  res.status(403).json({ error: 'Forbidden' });
  return;
}

const result = await pool.query(
  `SELECT * FROM group_resources WHERE organization_id = $1 AND group_id = $2`,
  [orgId, req.params.groupId]
);
```

### Adding Input Validation

```typescript
// Before: No validation
export const updateHandler = async (req: Request, res: Response) => {
  const { name, email } = req.body; // Unvalidated!
  // ...
};

// After: Validate input
export const updateHandler = async (req: Request, res: Response) => {
  const payload = parseUpdatePayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }
  // ...
};
```

## Key Files Reference

**Authentication & Authorization:**

- `packages/api/src/middleware/auth.ts` - Main auth middleware
- `packages/api/src/middleware/admin-session.ts` - Admin gate middleware
- `packages/api/src/lib/jwt.ts` - JWT creation/verification
- `packages/api/src/lib/sessions.ts` - Session management

**Route Directories:**

- `packages/api/src/routes/admin/` - Admin-only routes
- `packages/api/src/routes/auth/` - Authentication routes
- `packages/api/src/routes/vfs/` - Virtual filesystem (encrypted)
- `packages/api/src/routes/vfs-shares/` - File sharing
- `packages/api/src/routes/ai-conversations/` - AI chat

**Database Schema:**

- `packages/api/src/migrations/v005.ts` - Admin flag
- `packages/api/src/migrations/v007.ts` - Organizations
- `packages/api/src/migrations/v008.ts` - VFS encryption & sharing
- `packages/api/src/migrations/v017.ts` - Account disable/deletion
- `packages/api/src/migrations/` - Group and membership tables (for example `groups`, `group_users`) must enforce organization-local constraints

## Guardrails

- Do not weaken existing security checks
- Do not remove authorization middleware
- Do not expose additional sensitive data
- Keep security fixes focused and minimal
- Add tests for all security checks
- Document any security-related design decisions

## Quality Bar

- Zero new security vulnerabilities introduced
- All routes have appropriate auth checks
- All user-scoped queries filter by user/owner ID
- All org-scoped queries filter by organization ID
- All group-scoped queries filter by `group_id` and verify membership within the same organization
- All input is validated before use
- All tests pass
- Lint and typecheck pass

## PR Strategy

Use incremental PRs by category:

- PR 1: Fix missing authorization checks
- PR 2: Add organization and group boundary enforcement
- PR 3: Fix IDOR vulnerabilities (user and group scope)
- PR 4: Add input validation to routes

In each PR description, include:

- What security issues were fixed
- Routes affected and why
- Test coverage added
- Security impact assessment

## Token Efficiency

Discovery commands can return many lines. Always limit output:

```bash
# Count first, then list limited results
rg -l ... | wc -l                 # Get count
rg -l ... | head -20              # Then sample

# Suppress verbose validation output
pnpm --filter @tearleads/api typecheck >/dev/null
pnpm --filter @tearleads/api lint >/dev/null
pnpm --filter @tearleads/api test >/dev/null
git commit -S -m "message" >/dev/null
git push >/dev/null
```

On failure, re-run without suppression to see errors.
