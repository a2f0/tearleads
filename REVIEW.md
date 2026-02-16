# Code Review Instructions

This document provides review guidelines for AI agents (Gemini, Claude Code, Codex) and human reviewers. These instructions supplement the codebase-specific rules in CLAUDE.md and AGENTS.md.

## Quick Reference

| Area       | Key Files                      | Watch For                        | Detailed Standards |
| ---------- | ------------------------------ | -------------------------------- | ------------------ |
| TypeScript | *.ts, *.tsx                | any, as casts, @ts-ignore  | [TypeScript](./docs/reviews/typescript.md) |
| React      | packages/*/src/components/   | Oversized files, missing tests   | [React](./docs/reviews/react.md) |
| API        | packages/api/src/routes/     | Auth checks, ownership           | [API Security](./docs/reviews/api-security.md) |
| Database   | packages/*/src/**/*.ts       | N+1 queries, missing indexes     | See below |
| Security   | All routes, auth code          | Boundary violations, injection   | [Security](./docs/reviews/security-compliance.md) |
| i18n       | packages/*/src/i18n/         | Missing keys, hardcoded strings  | [i18n](./docs/reviews/i18n.md) |

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

## Testing Standards

- **Maintain or increase coverage** - Never decrease thresholds
- **New code requires tests** - No untested features
- **Happy path + error cases** - Both must be covered

## Commit and PR Standards

- **Conventional commits**: type(scope): description
- **Scope**: Feature-based (auth, settings, pwa)
- **50 char subject limit**
- **Single concern** - One feature, one fix, one refactor

## File and Import Standards

### Environment Variables

- **All caps only** - Environment variables (e.g., TF_VAR_HCLOUD_TOKEN) must always be all uppercase to ensure consistency across all automation and infrastructure tools.

### File Restrictions

- **Binary files** - Use SVG or external URLs
- **JavaScript files** - TypeScript only (.ts, .tsx)
- **Circular imports** - Extract shared code to break cycles

## Review Response Guidelines

### Be Concise and Actionable

```markdown
// GOOD:
Missing auth check. Add getAuthClaims() validation before line 42.

// BAD:
I noticed that this route doesn't seem to have any authentication...
```

---

_This document is maintained by the preen-review-instructions skill. Run /preen-review-instructions to audit for gaps._
