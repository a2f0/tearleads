---
name: preen-split-react-components
description: Proactively search the monorepo for oversized React component files and refactor them into small, named, one-component-per-file modules with clear folder organization and colocated tests. Use when maintaining code quality or during slack time.
---


# Preen Split React Components

Proactively search the monorepo for oversized React component files and refactor them into small, named, one-component-per-file modules with clear folder organization and colocated tests.

## When to Run

Run this skill when maintaining code quality or during slack time. It searches the entire codebase for refactoring opportunities.

## Discovery Phase

Search all packages for large TSX files that may benefit from splitting:

```bash
# Find TSX files over 300 lines (high likelihood of split candidates)
find . -name "*.tsx" -not -path "*/node_modules/*" -not -path "*/.next/*" -not -path "*/dist/*" | xargs wc -l 2>/dev/null | sort -rn | head -20

# Find files with multiple component definitions
rg -n --glob '*.tsx' '^export function|^export const.*=.*=>' . | cut -d: -f1 | sort | uniq -c | sort -rn | head -10
```

## Decide If Refactor Is Worth It

Prioritize files that meet at least two signals:

- TSX file is hard to scan (roughly 300+ lines or deep nesting)
- Multiple logical UI sections exist in one file
- Repeated JSX patterns appear in the same file
- File-level props/state/effects are hard to reason about
- Self-contained UI blocks that manage their own state (dropdowns, modals, settings panels)

**Do NOT split files that:**

- Have tightly coupled state shared across components
- Would require excessive prop drilling after extraction
- Are already well-organized with clear boundaries
- Are test files or storybook files
- Would result in tiny abstraction-only components with no readability gain

If no candidate meets at least two signals, report that no high-value split was found and stop.

## Target Structure

- One component per file
- Group related components by feature folder
- Colocate tests next to each component
- Use explicit component names that describe role, not styling

Example:

```text
src/features/billing/BillingPage.tsx
src/features/billing/BillingHeader.tsx
src/features/billing/PlanCard.tsx
src/features/billing/PlanCard.test.tsx
src/features/billing/index.ts
```

## Workflow

1. **Discovery**: Run the discovery commands to identify candidates across all packages.
2. **Selection**: Choose one high-value file that meets at least two signals.
3. **Analysis**: Identify natural boundaries (header, list item, card, footer, modal content, dropdown, settings panel).
4. **Create branch**: `git checkout -b refactor/split-<component-name>`
5. **Extract**: Extract one subcomponent at a time into its own file.
6. **Minimize props**: Pass minimal props; avoid prop drilling by extracting at the nearest sensible boundary.
7. **Preserve DOM**: Keep class names and DOM structure stable unless there is a clear bug fix.
8. **Rename**: Use domain-oriented names for extracted components.
9. **Tests (CRITICAL)**: When extracting code into new files, you MUST create or update tests to maintain coverage thresholds. Splitting code without tests causes CI failures.
10. **Coverage check**: Run `pnpm --filter @tearleads/<package> test:coverage` for the affected package. DO NOT proceed if coverage thresholds fail.
11. **Validate**: Run lint, type-check, and relevant tests to ensure no regressions.
12. **Commit and merge**: Run `/commit-and-push`, then `/enter-merge-queue`.

If no high-value split was found during discovery, do not create a branch or run commit/merge workflows.

## Guardrails

- Do not mix broad visual redesign with structural refactor
- Do not create tiny abstraction-only components with no readability gain
- Do not introduce `any` or unsafe type assertions
- Keep public API stable for consumers
- Avoid mass-file moves in one PR; prefer small batches
- Ensure extracted components are truly self-contained

## PR Strategy

Use incremental PRs:

- PR 1: Extract structure with no behavior changes
- PR 2+: Optional cleanup (shared primitives, style deduplication) only if justified

In each PR description, include:

- Why this file was selected
- What boundaries were extracted
- Confirmation of no behavior change
- Test evidence

## Token Efficiency

Discovery commands can return many lines. Always limit output:

```bash
# Already limited with head -20 and head -10 above

# Suppress verbose validation output
pnpm lint >/dev/null
pnpm typecheck >/dev/null
pnpm test >/dev/null
git commit -S -m "message" >/dev/null
git push >/dev/null
```

On failure, re-run without suppression to see errors.
