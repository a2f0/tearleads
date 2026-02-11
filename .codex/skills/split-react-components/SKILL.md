---
name: split-react-components
description: Refactor oversized React component files into small, named, one-component-per-file modules with clear folder organization and colocated tests. Use when TSX files contain multiple UI blocks, deeply nested Tailwind markup, unclear component boundaries, or repeated JSX that hurts readability and maintainability.
---

# Split React Components

Refactor for clarity without doing cosmetic churn.

## Goals

- Keep behavior identical.
- Improve readability and navigation.
- Establish durable naming and folder structure.
- Preserve or improve test coverage.

## Decide If Refactor Is Worth It

Prioritize files that meet at least two signals:

- TSX file is hard to scan (roughly 200+ lines or deep nesting).
- Multiple logical UI sections exist in one file.
- Repeated JSX patterns appear in the same file.
- File-level props/state/effects are hard to reason about.
- Reviews frequently include readability or structure feedback.

Defer refactor-only work when the file is stable and simple, or when change risk is high and no product work depends on it.

## Target Structure

- One component per file.
- Group related components by feature folder.
- Colocate tests next to each component.
- Use explicit component names that describe role, not styling.

Example:

```text
src/features/billing/BillingPage.tsx
src/features/billing/BillingHeader.tsx
src/features/billing/PlanCard.tsx
src/features/billing/PlanCard.test.tsx
src/features/billing/index.ts
```

## Workflow

1. Choose one high-value file only.
2. Identify natural boundaries (header, list item, card, footer, modal content).
3. Extract one subcomponent at a time into its own file.
4. Pass minimal props; avoid prop drilling by extracting at the nearest sensible boundary.
5. Keep class names and DOM structure stable unless there is a clear bug fix.
6. Rename components to domain-oriented names.
7. Update colocated tests or add focused tests for extracted logic.
8. Run lint, type-check, and relevant tests.

## Guardrails

- Do not mix broad visual redesign with structural refactor.
- Do not create tiny abstraction-only components with no readability gain.
- Do not introduce `any` or unsafe type assertions.
- Keep public API stable for consumers.
- Avoid mass-file moves in one PR; prefer small batches.

## PR Strategy

Use incremental PRs:

- PR 1: Extract structure with no behavior changes.
- PR 2+: Optional cleanup (shared primitives, style deduplication) only if justified.

In each PR description, include:

- Why this file was selected.
- What boundaries were extracted.
- Confirmation of no behavior change.
- Test evidence.
