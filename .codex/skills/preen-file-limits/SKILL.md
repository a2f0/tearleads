---
name: preen-file-limits
description: Proactively search for files exceeding project size limits (500 lines or 20,000 bytes) and refactor them into smaller, more modular components or modules.
---

# Preen File Limits

Proactively search for files exceeding project size limits (500 lines or 20,000 bytes) and refactor them into smaller, more modular components or modules.

## When to Run

Run this skill when maintaining code quality or during slack time. It searches the entire codebase for files that exceed the project's size limits as defined in `scripts/checks/checkFileLimits.sh`.

## Discovery Phase

Search all files for those exceeding size limits:

```bash
# Find all files exceeding 500 lines or 20,000 bytes
./scripts/checks/checkFileLimits.sh --all 2>&1 | head -40
```

## Decide If Refactor Is Worth It

Prioritize files that meet at least one signal:

- File is significantly over limits (e.g., >700 lines or >30,000 bytes)
- File contains multiple logical responsibilities that can be easily extracted
- File contains repetitive patterns that could be abstracted
- File is a component or module that is central to the application and hard to maintain

**Do NOT split files that:**

- Are strictly ignored by `scripts/checks/checkFileLimits.sh`
- Would become less readable after splitting (e.g., highly coupled logic)
- Are generated files (though these should be ignored by the script)
- Are large documentation files where splitting doesn't add value (unless they can be naturally partitioned)

If no candidate meets the criteria, report that no high-value refactor was found and stop.

## Target Structure

- One logical responsibility per file
- Group related files in feature folders or subdirectories
- Colocate tests next to the extracted modules
- Use explicit names that describe the role of the extracted content

## Workflow

1. **Discovery**: Run the discovery command to identify files exceeding limits.
2. **Selection**: Choose one high-value candidate.
3. **Analysis**: Identify natural boundaries for extraction (e.g., sub-components, utility functions, types, hooks, constants).
4. **Create branch**: `git checkout -b refactor/split-<filename-or-module>`
5. **Extract**: Extract one piece of logic at a time into its own file.
6. **Update Imports**: Ensure all references are correctly updated.
7. **Tests (CRITICAL)**: When extracting code into new files, you MUST create or update tests to maintain coverage thresholds. Splitting code without tests causes CI failures.
8. **Coverage check**: Run `pnpm --filter @tearleads/<package> test:coverage` for the affected package. DO NOT proceed if coverage thresholds fail.
9. **Validate**: Run lint, type-check, and relevant tests to ensure no regressions.
10. **Commit and merge**: Run `<cmd:commit-and-push>`, then `<cmd:enter-merge-queue>`.

## Guardrails

- Do not change behavior; only restructure code.
- Ensure extracted components/modules are truly self-contained.
- Avoid mass-file moves in one PR; focus on one large file at a time.
- Maintain public APIs where possible to avoid breaking consumers.

## Token Efficiency

```bash
# Suppress verbose validation output
pnpm lint >/dev/null
pnpm typecheck >/dev/null
pnpm test >/dev/null
git commit -S -m "message" >/dev/null
git push >/dev/null
```

On failure, re-run without suppression to see errors.
