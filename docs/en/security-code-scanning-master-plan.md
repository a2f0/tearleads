# Security Code-Scanning Master Plan

## Objective

Reduce open GitHub code-scanning findings to zero where feasible, and explicitly document justified dismissals where not feasible.

## Baseline (March 5, 2026)

Open alerts: **26**

- `js/clear-text-storage-of-sensitive-data`: 13 (`error`)
- `js/polynomial-redos`: 8 (`warning`)
- `js/shell-command-injection-from-environment`: 2 (`warning`)
- `js/incomplete-multi-character-sanitization`: 2 (`warning`)
- `js/prototype-polluting-assignment`: 1 (`warning`)

## Remediation Waves

### Wave 1: Low-Risk Code Safety (Complete in this branch)

Targets:

- `js/shell-command-injection-from-environment` in DB schema generators
- `js/prototype-polluting-assignment` in classic sorting metadata maps
- A subset of `js/polynomial-redos` in utility parsers/validators

Acceptance criteria:

- Replace shell-interpolated commands with argument-safe process execution
- Use null-prototype maps for untrusted/dynamic keys
- Replace vulnerable regex flows with linear parsing logic
- Add/adjust tests around modified parsing/validation behavior

### Wave 2: Markdown Heading Parser + Sanitization Hardening

Targets:

- `js/incomplete-multi-character-sanitization` (markdown viewer)
- Remaining markdown-related `js/polynomial-redos`

Acceptance criteria:

- Heading extraction is linear-time over input size
- No regex with nested/ambiguous quantifiers in heading extraction paths
- Heading text cleanup is deterministic and strips HTML-like tags safely for TOC text use
- Existing TOC behavior remains stable (links, duplicate heading suffixes, fence handling)

### Wave 3: Client Token Storage Redesign (High Thought / Architectural)

Targets:

- Runtime `js/clear-text-storage-of-sensitive-data` in `authStorage`

Planned direction:

- Move refresh token handling to secure, HTTP-only cookie flow
- Keep access token ephemeral (in-memory) or eliminate client-managed bearer token where possible
- Preserve session-expiry UX and multi-tab synchronization

Acceptance criteria:

- No auth/refresh JWT persisted to browser storage in clear text
- Login/refresh/logout/session-expiry test coverage updated
- Migration path for existing sessions documented

### Wave 4: Test Fixture Sensitive-Data Policy

Targets:

- Test-only `js/clear-text-storage-of-sensitive-data` alerts from seeded JWT fixture storage

Approach:

- Replace stored seeded JWT values with non-sensitive deterministic fixture tokens where behavior allows
- If a real token shape is required, isolate helper and document why
- Dismiss only after proving the alert is test-only and non-production

Acceptance criteria:

- No unresolved production-impacting clear-text alerts
- Any dismissed test-only alert has clear rationale in alert comments

### Wave 5: Deep API Authorization Hardening Audit

Scope:

- Organization boundary checks
- Group membership boundary checks
- Admin-only route enforcement
- IDOR and data exposure review

Execution notes:

- Run discovery sweeps in `packages/api/src/connect/services` and `packages/api/src/http`
- Prioritize missing/weak auth checks before query-shape optimizations
- Require regression tests for any fixed authorization boundary

Acceptance criteria:

- Every privileged endpoint has explicit auth + scope verification
- Admin routes consistently enforce admin session checks
- No cross-org or cross-group access without explicit authorization

## Operating Model

1. Take one rule-family slice per PR.
2. Land tests with each fix slice.
3. Re-check open alerts after each merge.
4. Keep a running status update in this document after each wave.

## Tracking Commands

```bash
REPO=$(./scripts/agents/tooling/agentTool.ts getRepo)
gh api "/repos/$REPO/code-scanning/alerts?state=open&per_page=100" \
  | jq -r 'group_by(.rule.id) | map({rule: .[0].rule.id, count: length})'
```
