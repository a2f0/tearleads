<!-- COMPLIANCE_SENTINEL: TL-VENDOR-010 | control=google-gemini-vendor -->

# Gemini Code Review Instructions

When reviewing pull requests in this repository, follow these guidelines.

## Priority Areas

1. **Security** - Auth checks, ownership verification, SQL injection
2. **Type Safety**
3. **Environment Variables** - Non-Terraform variables stay **ALL CAPS**, while Terraform `TF_VAR_*` inputs match snake_case names (e.g., `TF_VAR_domain`, `TF_VAR_server_username`)
4. **Test Coverage** - New code must have tests
5. **Performance** - N+1 queries, missing memoization

## TypeScript Rules

Flag these as issues:

- `: any` or `<any>` type annotations
- `as SomeType` type assertions (use type guards instead)
- `@ts-ignore` or `@ts-expect-error` without documented reason
- Non-null assertions (`!`) without justification

Suggest instead:

- Type guards with `typeof`, `in`, or custom functions
- `unknown` type with proper narrowing
- Generic constraints

## API Security

Every route must have:

1. **Authentication check** - `getAuthClaims()` or equivalent
2. **Authorization check** - User has permission for action
3. **Ownership verification** - User can access specific resource

Flag routes missing these checks, especially:

- `PUT`, `POST`, `DELETE` operations
- Routes accessing user data
- Admin-only operations

## Database Patterns

Flag N+1 queries:

```typescript
// BAD - Flag this pattern
for (const user of users) {
  await db.select().from(orders).where(eq(orders.userId, user.id));
}
```

Suggest batched queries or joins.

## React Standards

- Components should be <300 lines
- Tests colocated with components
- `text-base` (16px) minimum on form inputs
- Use existing shared components from `@/components/ui/`

## Test Quality

Flag:

- Fixed `setTimeout` delays
- Time-dependent assertions
- Missing error case coverage
- Decreased coverage thresholds

## Security and Compliance

### Security Checks

Flag these security issues:

- Missing auth checks on routes (`getAuthClaims()`)
- Missing ownership verification for resource access
- String interpolation in SQL queries (SQL injection risk)
- Unvalidated request bodies
- Exposed sensitive data in responses (passwords, keys)
- IDOR vulnerabilities (accessing other users' data)

### Compliance Documentation

Security controls are documented in `compliance/` with sentinels like `TL-INFRA-001`.

Flag if PRs adding security controls don't update:

- `compliance/infrastructure-controls.md` (new sentinels)
- Framework triads (HIPAA, NIST, SOC2 policies/procedures/control-maps)

### Quick Security Checklist

- [ ] Auth check present on new routes
- [ ] Ownership verification for resource access
- [ ] Parameterized queries (no string interpolation)
- [ ] Input validation before database operations
- [ ] Compliance docs updated for new security controls

## Commit Standards

- Conventional commits: `type(scope): description`
- 50 char subject limit
- Single concern per PR

## What NOT to Flag

- Style preferences already handled by linting
- Minor naming variations
- Documentation additions
- Test-only changes

## Response Format

Be concise and actionable:

```text
Missing auth check. Add getAuthClaims() validation at line 42.
```

Not:

```text
I noticed that this route doesn't seem to have authentication...
```

## References

See `REVIEW.md` in the repository root for complete guidelines.
