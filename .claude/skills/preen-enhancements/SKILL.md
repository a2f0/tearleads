---
name: preen-enhancements
description: High-risk maintenance workflow for evolving the preen ecosystem (registry, parity checks, new categories, and automation guardrails).
---


# Misc Preen Enhancements

Use this skill when you need to evolve the preen ecosystem itself, not just run a preen pass.

## Goals

- Keep Claude/Codex preen docs semantically aligned
- Prevent command-prefix drift (`/command` vs `$command`)
- Manage categories from one machine-readable source
- Ensure guardrails enforce parity in pre-push and CI

## Canonical Files

- `scripts/preen/registry.json` - Source of truth for preen categories
- `scripts/preen/generatePreenDocs.sh` - Generates top-level preen docs
- `scripts/checkPreenEcosystem.sh` - Semantic parity + lint checks
- `.claude/commands/preen.md` - Generated target
- `.codex/skills/preen/SKILL.md` - Generated target

## Workflow

1. Update `scripts/preen/registry.json` for category additions/removals/ordering.
1. Regenerate top-level docs:

```bash
./scripts/preen/generatePreenDocs.sh
```

1. Run strict ecosystem checks:

```bash
./scripts/checkPreenEcosystem.sh --strict
```

1. Resolve any parity, command-style, or generation drift findings.
1. Run impacted quality/tests for touched code paths.
1. Commit with a focused message and proceed through the normal PR + merge queue flow.

## Adding a New Preen Category

When adding a category (for example `preen-foo`):

1. Add registry entry in `scripts/preen/registry.json`.
1. Create paired docs:

- `.claude/commands/preen-foo.md`
- `.codex/skills/preen-foo/SKILL.md`

1. Ensure Codex uses `/commit-and-push` and `/enter-merge-queue`.
1. Regenerate docs and rerun strict checks.

## Guardrails

- Never hand-edit generated top-level preen docs without rerunning the generator.
- Keep category scope focused: one meaningful fix per run by default.
- Prefer `rg`-based discovery commands for speed and consistency.
- Avoid introducing behavior changes when the intent is hygiene hardening.
