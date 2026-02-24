# Code Review Instructions

This document provides review guidelines for AI agents (Gemini, Claude Code, Codex) and human reviewers. These instructions supplement the codebase-specific rules in CLAUDE.md and AGENTS.md.

## Quick Reference

| Area          | Key Files                    | Watch For                       | Detailed Standards                                              |
|---------------|------------------------------|---------------------------------|-----------------------------------------------------------------|
| TypeScript    | `*.ts`, `*.tsx`              | `any`, `as` casts, `@ts-ignore` | [TypeScript](./docs/agent-instructions/reviews/typescript.md)   |
| React         | `packages/*/src/components/` | Oversized files, missing tests  | [React](./docs/agent-instructions/reviews/react.md)             |
| API           | `packages/api/src/routes/`   | Auth checks, ownership          | [API Security](./docs/agent-instructions/reviews/api-security.md) |
| Database      | `packages/*/src/**/*.ts`     | N+1 queries, missing indexes    | [Database](./docs/agent-instructions/reviews/database.md)       |
| Security      | All routes, auth code        | Boundary violations, injection  | [Security](./docs/agent-instructions/reviews/security-compliance.md) |
| i18n          | `packages/*/src/i18n/`       | Missing keys, hardcoded strings | [i18n](./docs/agent-instructions/reviews/i18n.md)               |
| Testing       | `*.test.ts`, `*.test.tsx`    | Coverage, async patterns        | [Testing](./docs/agent-instructions/reviews/testing.md)         |
| Accessibility | `packages/*/src/components/` | ARIA, keyboard navigation       | [Accessibility](./docs/agent-instructions/reviews/accessibility.md) |
| Errors        | All code                     | Boundaries, Result types        | [Error Handling](./docs/agent-instructions/reviews/error-handling.md) |

## TypeScript Standards

- Reject new `any`, unsafe `as` assertions, and `@ts-ignore`/`@ts-expect-error` usage in production code.
- Ensure exposed APIs prefer explicit types over inferred `unknown` at module boundaries.
- Apply the detailed checklist in [`docs/agent-instructions/reviews/typescript.md`](./docs/agent-instructions/reviews/typescript.md).

## React Standards

- Keep one component per file and colocate tests with component files.
- Flag oversized component files and extract focused subcomponents to preserve readability and testability.
- Apply the detailed checklist in [`docs/agent-instructions/reviews/react.md`](./docs/agent-instructions/reviews/react.md).

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

- **All caps only** - Non-Terraform environment variables (e.g., `DATABASE_URL`, `GITHUB_TOKEN`) must always be uppercase to stay consistent across automation and tool chains.
- **Terraform inputs** - When you export `TF_VAR_*` variables, make the suffix match the Terraform input name in snake_case (e.g., `TF_VAR_hcloud_token`, `TF_VAR_server_username`, `TF_VAR_domain`). Keeping Terraform variables in snake_case keeps the configuration aligned with community conventions and avoids confusing casing differences between the environment and Terraform code.

### File Restrictions

- **Binary files** - Use SVG or external URLs
- **JavaScript files** - TypeScript only (.ts, .tsx)
- **Circular imports** - Extract shared code to break cycles
- **File size** - Stay under 500 lines / 20,000 bytes; push shared types into `scripts/agents/tooling/types.ts`, helpers/actions into `scripts/agents/tooling/utils/`, and delegate CLI wiring to `scripts/agents/tooling/utils/commandFactory.ts` so entry points stay lean.

## Review Response Guidelines

### Be Concise and Actionable

```markdown
// GOOD:
Missing auth check. Add getAuthClaims() validation before line 42.

// BAD:
I noticed that this route doesn't seem to have any authentication...
```

---

*This document is maintained by the preen-review-instructions skill. Run /preen-review-instructions to audit for gaps.*

## Automation

- Use `./scripts/agents/tooling/agentTool.ts createIssue --type user-requested --title "feat: <desc>" --search "<keywords>"` for user-requested issues.
- Use `./scripts/agents/tooling/agentTool.ts createIssue --type deferred-fix --title "chore: deferred fix from PR #<n>" --source-pr <n> --review-thread-url "<thread-url>"` for deferred fixes.
- Run `./scripts/agents/tooling/agentTool.ts runPreen --mode audit --dry-run` to preview the discovery output that feeds this guidance and the related review-instructions skill.
