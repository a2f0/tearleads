# Code Review Instructions

This document provides review guidelines for AI agents (Gemini, Claude Code, Codex) and human reviewers. These instructions supplement the codebase-specific rules in `CLAUDE.md` and `AGENTS.md`.

## Quick Reference

| Area       | Key Files                      | Watch For                        |
| ---------- | ------------------------------ | -------------------------------- |
| TypeScript | `*.ts`, `*.tsx`                | `any`, `as` casts, `@ts-ignore`  |
| React      | `packages/*/src/components/`   | Oversized files, missing tests   |
| API        | `packages/api/src/routes/`     | Auth checks, ownership           |
| Database   | `packages/*/src/**/*.ts`       | N+1 queries, missing indexes     |
| Security   | All routes, auth code          | Boundary violations, injection   |
| i18n       | `packages/*/src/i18n/`         | Missing keys, hardcoded strings  |

## TypeScript Standards

### Required

- **Explicit types** for function parameters and return values
- **Type guards** over type assertions
- **Strict null checking** - no non-null assertions (`!`) without justification
- **Generic constraints** when accepting unknown types

### Prohibited

```typescript
// NEVER accept these patterns in review:
const x: any = ...           // Use unknown + type narrowing
const y = value as SomeType  // Use type guards instead
// @ts-ignore                // Fix the underlying type issue
// @ts-expect-error          // Use only with documented reason
```

### Preferred Patterns

```typescript
// Type narrowing with guards
function processValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isCustomType(value)) return value.toString();
  throw new Error('Unexpected type');
}

// Assertion functions for complex checks
function assertIsUser(value: unknown): asserts value is User {
  if (!value || typeof value !== 'object' || !('id' in value)) {
    throw new Error('Not a valid User');
  }
}
```

## React Standards

### Component Organization

- **One component per file** - Split when a file exceeds ~300 lines
- **Colocated tests** - `Component.tsx` + `Component.test.tsx` side by side
- **Feature folders** - Group related components by feature, not type
- **Shared components** in `packages/*/src/components/ui/`

### Hooks

- **Custom hooks** for shared logic - extract when used in 2+ components
- **Dependency arrays** must be complete - ESLint should catch violations
- **Avoid inline objects** in dependency arrays - use `useMemo` or extract

### Performance

```typescript
// Memoize expensive computations
const expensiveValue = useMemo(() => computeExpensive(data), [data]);

// Memoize callbacks passed to children
const handleClick = useCallback((id: string) => {
  dispatch(selectItem(id));
}, [dispatch]);

// Virtualize long lists (>100 items)
<VirtualList items={items} renderItem={...} />
```

### Testing

- **React Testing Library** patterns - query by role, label, text
- **User-centric assertions** - test behavior, not implementation
- **MSW for API mocking** - handlers in `packages/*/src/mocks/`

## API Security

### Authorization Hierarchy

```text
Admin > Org Admin > Group Admin > User
```

Every route must verify:

1. **Authentication** - Valid session/token
2. **Authorization** - Permission for the action
3. **Ownership** - Access to the specific resource

### Required Checks

```typescript
// Example: Editing a resource
router.put('/resources/:id', async (req, res) => {
  // 1. Auth check
  const claims = await getAuthClaims(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  // 2. Ownership check
  const [resource] = await db.select().from(resources).where(eq(resources.id, req.params.id));
  if (!resource || (resource.userId !== claims.userId && !claims.isAdmin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 3. Proceed with operation
});
```

### SQL Injection Prevention

```typescript
// GOOD: Parameterized queries
await db.select().from(users).where(eq(users.id, userId));

// BAD: String interpolation
await db.execute(`SELECT * FROM users WHERE id = '${userId}'`);  // NEVER
```

### Review Checklist for Routes

- [ ] Authentication check present
- [ ] Authorization check for user role
- [ ] Ownership verification for resource access
- [ ] Input validation before database operations
- [ ] Parameterized queries only

## Database Performance

### N+1 Query Detection

Flag this pattern:

```typescript
// BAD: N+1 query
for (const user of users) {
  const userOrders = await db.select().from(orders).where(eq(orders.userId, user.id));
}

// GOOD: Single query with join or batch
const usersWithOrders = await db
  .select()
  .from(users)
  .leftJoin(orders, eq(users.id, orders.userId));
```

### Index Awareness

When reviewing queries with:

- `WHERE` clauses on non-primary key columns
- `ORDER BY` on large tables
- `JOIN` conditions

Ask: Is there an index for this?

## Testing Standards

### Coverage Requirements

- **Maintain or increase coverage** - Never decrease thresholds
- **New code requires tests** - No untested features
- **Happy path + error cases** - Both must be covered

### Test Quality

```typescript
// GOOD: Descriptive, behavior-focused
it('displays error message when login fails with invalid credentials', async () => {
  // Arrange
  server.use(http.post('/api/login', () => HttpResponse.json({ error: 'Invalid' }, { status: 401 })));

  // Act
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

  // Assert
  expect(await screen.findByRole('alert')).toHaveTextContent(/invalid credentials/i);
});

// BAD: Implementation-focused
it('calls setError with message', () => {
  // Testing internal state changes
});
```

### Flaky Test Patterns to Flag

```typescript
// Flag these patterns:
await new Promise(r => setTimeout(r, 1000));  // Fixed delays
expect(someValue).toBe(Date.now());            // Time-dependent
Math.random();                                  // Non-deterministic
```

## Internationalization (i18n)

See [Internationalization (i18n) Review Guidelines](docs/en/review-i18n.md) for detailed instructions.

## Security and Compliance

See [Security and Compliance Review Guidelines](docs/en/review-security.md) for detailed instructions.

## Commit and PR Standards

### Commit Messages

- **Conventional commits**: `type(scope): description`
- **Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`
- **Scope**: Feature-based (`auth`, `settings`, `pwa`)
- **50 char subject limit**

### PR Scope

- **Single concern** - One feature, one fix, one refactor
- **Atomic changes** - Reviewable as a unit
- **Complete** - Includes tests, types, documentation updates

### What to Flag in PRs

- Multiple unrelated changes
- Missing tests for new functionality
- Decreased coverage
- New `any` types or type assertions
- New dependencies without justification
- Security-sensitive changes without security review

## File and Import Standards

### File Restrictions

- **Binary files** - Use SVG or external URLs
- **JavaScript files** - TypeScript only (`.ts`, `.tsx`)
- **Circular imports** - Extract shared code to break cycles

### Import Order

```typescript
// 1. Node/framework imports
import { useState } from 'react';

// 2. External packages
import { z } from 'zod';

// 3. Internal aliases (@/)
import { Button } from '@/components/ui/button';

// 4. Relative imports
import { localHelper } from './helpers';
```

## Review Response Guidelines

### Be Concise and Actionable

```markdown
// GOOD:
Missing auth check. Add `getAuthClaims()` validation before line 42.

// BAD:
I noticed that this route doesn't seem to have any authentication
checks which could potentially be a security concern...
```

### Severity Levels

- **Blocker**: Security issues, data loss risk, breaking changes
- **Major**: Bugs, missing tests, type safety violations
- **Minor**: Style, naming, documentation
- **Suggestion**: Alternative approaches, optimizations

### When to Approve

- No blockers or major issues
- Minor issues can be addressed in follow-up
- Code follows established patterns

### When to Request Changes

- Security vulnerabilities
- Missing required functionality
- Test coverage decrease
- Type safety violations

## Codebase-Specific Patterns

### Package Structure

```text
packages/
  api/          # Backend API routes and services
  web/          # Next.js web application
  mobile/       # React Native mobile app
  shared/       # Shared types and utilities
```

### Shared UI Components

Location: `packages/*/src/components/ui/`

When reviewing UI changes:

- Use existing shared components (`Input`, `Button`, etc.)
- Check for `text-base` on form inputs (prevents iOS zoom)
- Verify accessibility attributes

### MSW Handlers

Location: `packages/*/src/mocks/handlers/`

When reviewing API changes:

- Update corresponding MSW handlers
- Maintain parity between routes and mocks

## Version History

| Date       | Change                                      |
| ---------- | ------------------------------------------- |
| 2026-02-15 | Add security and compliance review section  |
| 2026-02-14 | Add i18n review guidelines                  |
| 2026-02-14 | Initial comprehensive review instructions   |

---

_This document is maintained by the `preen-review-instructions` skill. Run `/preen-review-instructions` to audit for gaps._
