<!-- COMPLIANCE_SENTINEL: TL-VENDOR-009 | control=openai-vendor -->

# Agent Notes (Codex)

This file is for Codex. Claude Code uses CLAUDE.md.

## Code Verification

**Always verify the actual state of the codebase before making claims.** Before stating that something is "already done," "doesn't exist," or "works a certain way," check the actual code to confirm. Issue descriptions, commit messages, or GitHub comments may not reflect the current state of the repository.

Common mistakes:

- Assuming code exists based on an issue description without checking
- Claiming something is "already implemented" without verifying
- Trusting that file paths mentioned in issues are correct

When in doubt, use search tools (`grep`, `glob`) or read the relevant files directly to verify.

## Repository Identification (CRITICAL)

**Never infer the repository name from the workspace folder name.** Workspaces like `tearleads2`, `tearleads10`, `tearleads-main` are all clones of the same repository.

To get the correct repo for `gh` commands:

```bash
./scripts/agents/tooling/agentTool.ts getRepo
```

Always use `--repo` or `-R` flag with `gh` commands when the repo might be ambiguous:

```bash
REPO=$(./scripts/agents/tooling/agentTool.ts getRepo)
gh issue list -R "$REPO"
gh pr view 123 -R "$REPO"
```

## Issue Tracking

**Do NOT create issues automatically** except for deferred fixes. Only create GitHub issues when:

1. The user explicitly asks for one, OR
2. Review feedback is being deferred to a follow-up PR (handled by `$enter-merge-queue` and `$address-gemini-feedback`)

### User-Requested Issues

When the user explicitly requests an issue:

1. **Check for existing issue**: Search for a related open issue first
2. **Create an issue if none exists**: Use `agentTool.ts createIssue` (it checks for an existing open issue first unless `--force` is set). After merge, `$enter-merge-queue` adds the "needs-qa" label.
3. **Do NOT auto-close issues**: Never use `Closes #`, `Fixes #`, or `Resolves #` in PR descriptions. Issues are marked "needs-qa" after merge for verification before manual closure.

```bash
./scripts/agents/tooling/agentTool.ts createIssue \
  --type user-requested \
  --title "feat: <brief description>" \
  --search "<keywords for dedupe>"
```

### Deferred Fix Issues

When review feedback cannot be addressed in the current PR and must be deferred:

1. **Create a tracking issue** with the `deferred-fix` label
2. **Reference the source PR** in the issue body
3. **Do NOT create issues for on-the-fly fixes** - only for work explicitly deferred

The `$enter-merge-queue` and `$address-gemini-feedback` skills handle deferred fix issue creation automatically. The `$preen-deferred-fixes` skill finds issues with the `deferred-fix` label to implement.

```bash
./scripts/agents/tooling/agentTool.ts createIssue \
  --type deferred-fix \
  --title "chore: deferred fix from PR #<number>" \
  --source-pr <number> \
  --review-thread-url "<thread-url>"
```

### Issue Guidelines

Issue-writing guidelines:

- Do not paste the user request verbatim; rewrite and organize it.
- Prefer clear, testable requirements over vague tasks.
- Add relevant context (impact, affected users, scope, constraints, examples).

Issue update guidelines:

- Avoid verbose comment threading; prefer updating the issue description with new info.
- If comments are needed, batch updates into larger chunks (milestones, decisions, blockers)

## Commit Guidelines

### Format

- Use conventional commits: `<type>(<scope>): <description>` (max 50 chars subject)
- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`
- Scope: prefer feature-based (`pwa`, `auth`, `settings`) over package-based
- Description in imperative mood ("add" not "added")
- GPG signing required with 5s timeout: `printf "message" | timeout 5 git commit -S -F -`

### Do NOT

- Add co-author lines (no "Co-Authored-By: Claude" or similar)
- Add "Generated with Claude Code" footers
- Force push unless explicitly instructed
- Use `--no-verify` to bypass git hooks
- Commit or push to `main` branch; create a new branch instead. To merge PRs, use `gh pr merge` or the GitHub UI - never merge locally and push.
- Use `any` typings or `as` TypeScript assertions
- Decrease code coverage thresholds; always write tests for new code
- Commit binary files (PNG, JPG, ICO, etc.); use SVG or external URLs
- Add comments that restate what code does; only comment non-obvious logic

### Coverage Failures

- If CI or local runs fail coverage thresholds, add tests to raise coverage and re-run the relevant `test:coverage` target locally before proceeding.

### Merge Conflict Resolution (CRITICAL)

When resolving merge conflicts during rebase, the goal is to **preserve BOTH the PR's changes AND main's changes**. Do not blindly discard either side.

**Git rebase terminology is counterintuitive:**

- During `git rebase`, `--ours` refers to the branch being rebased ONTO (main/upstream)
- During `git rebase`, `--theirs` refers to the branch being rebased (your PR branch)
- This is the **opposite** of `git merge`

**Resolution by file type:**

1. **Version files** (`package.json` versions, `build.gradle`, `project.pbxproj`):

   ```bash
   git checkout --ours <file>   # Keep main's version - will be re-bumped
   ```

2. **Lock files** (`pnpm-lock.yaml`):

   ```bash
   git checkout --ours pnpm-lock.yaml   # Keep main's version
   pnpm install                          # Regenerate after rebase
   ```

3. **Code files**: Do NOT use `--ours` or `--theirs` - both discard legitimate work. Open the file and combine both sets of changes. Keep additions from main AND keep the PR's changes.

If conflicts are on the exact same lines and truly incompatible, abort and ask for help rather than discarding either side's work.

## File Size Guardrail

Files must stay below 500 lines and 20,000 bytes. When the guardrail trips, split the logic into smaller modules—move shared types into `scripts/agents/tooling/types.ts`, helpers into `scripts/agents/tooling/utils/`, and delegate CLI wiring to `scripts/agents/tooling/utils/commandFactory.ts`—so entry points remain compact without losing functionality.

## Binary Files Policy

- Do not add binary files to the repo. Prefer SVG or external URLs.
- Binary guardrails run in `pre-commit` (staged files) and `pre-push` (unpushed commits).
- Allowed binaries must be explicitly listed in `scripts/checks/checkBinaryFiles.sh` with documented rationale in the issue or PR.

## JavaScript Files Policy

- Do not commit plain JavaScript files (`.js`, `.mjs`, `.cjs`, `.jsx`) to the repo.
- Use TypeScript files (`.ts`, `.tsx`) instead.
- JavaScript guardrails run in `pre-push` and CI via `scripts/checks/checkJs.sh`.

## Circular Imports Policy

- Do not introduce circular import cycles between modules.
- Circular imports cause runtime errors, undefined values, and bundler warnings.
- Guardrails run in `pre-push` and CI via `scripts/checks/checkCircularImports.ts`.
- To fix cycles: extract shared types/constants to a separate module, or restructure module boundaries.

## Husky Shell Compatibility Policy

- Husky hooks in `.husky/` must be strict POSIX `sh` compatible across environments.
- Use `#!/usr/bin/env sh` and `set -eu` in hook scripts. Do not use `set -o pipefail`.
- Do not use Bash-only features in hooks (`local`, `[[ ... ]]`, arrays, `source`, `function`, process substitution).
- If a hook needs advanced logic, move that logic to repo scripts and keep the hook as a thin POSIX `sh` wrapper.
- When modifying hooks, validate syntax with `sh -n .husky/<hook-file>` before committing.

## Node Version Management Policy

- Use `mise` for all Node version management.
- Do not install or upgrade Node with Homebrew in agent workflows.
- Scripts that manage Node versions must fail fast when `mise` is unavailable, then run `mise install node` against repo `.nvmrc`.

## Dependency Installation Policy

- It is always acceptable to install dependencies when needed to run tooling, tests, or scripts.
- Use `pnpm i` for a direct dependency install in the current workspace.
- Use `scripts/agents/refresh.sh` when a full workspace refresh is needed (main sync + install/build), especially after merges or large upstream changes.

## Greenfield Compatibility Policy

- This repository is in greenfield design mode and not in production.
- Do not add reverse-compatibility layers, compatibility re-export packages, or legacy alias modules.
- When touching an area that contains compatibility shims, prefer removing/collapsing the shim and importing the canonical module directly.
- If a compatibility layer blocks a safe change, remove it and update imports/tests in the same PR.

## PR Guidelines

- Do NOT add "Generated with Claude Code" footers to PR descriptions
- **Use merge commits**: When creating PRs or enabling automerge, use merge commits (not squash). Use `gh pr merge --merge --auto` for automerge.

## Token Efficiency (CRITICAL)

Git hooks (husky pre-commit, pre-push) run linting, type-checking, builds, and tests that produce thousands of lines of stdout. **This output burns tokens and provides no value on success.**

### MANDATORY: Suppress stdout on ALL git operations

```bash
# ALWAYS redirect stdout to /dev/null
git commit -S -m "message" >/dev/null
git push >/dev/null
git push --force-with-lease >/dev/null

# NEVER run git commit/push without suppression
git commit -m "message"          # WRONG - wastes tokens
git push                         # WRONG - wastes tokens
git push --force-with-lease      # WRONG - wastes tokens
```

### Why this matters

- Pre-push hooks can output 5,000+ lines (lint results, test output, build logs)
- Each line consumes tokens from the context window
- On success, only the exit code matters - stdout is noise
- On failure, errors appear on stderr (preserved by `>/dev/null`)
- Pre-push hooks may take several minutes; set a generous timeout on `git push`

### Other token-saving practices

- **Use `--json` with minimal fields**: `gh pr view --json state,mergeStateStatus` not `gh pr view`
- **Cache immutable data**: Store PR number, branch names, URLs from first fetch
- **Don't re-read files**: If you read a file once, don't read it again unless it changed
- **Batch related operations**: Combine status updates rather than outputting each individually

## Managing Codex Skills

The `.codex/skills/` folder contains reusable skills. Each workspace uses its own `.codex` folder from the repo.

## Tuxedo Instance Tagging

When working on PRs, tag them with the tuxedo instance (workspace folder name) to track which agent workspace worked on them. This is handled automatically by `/commit-and-push` and `/enter-merge-queue`, but can be invoked manually:

```bash
./scripts/agents/tooling/agentTool.ts tagPrWithTuxedoInstance
```

For the full `agentTool.ts` action list and options, see [`scripts/agents/tooling/README.md`](scripts/agents/tooling/README.md).

This:

- Auto-detects the PR from the current branch
- Removes any existing `tuxedo:*` labels
- Adds a `tuxedo:<instance>` label (e.g., `tuxedo:tearleads-shared`)
- Creates the label if it doesn't exist

## PR Thread Replies (CRITICAL)

- **Always reply inside the review thread** when addressing Gemini or other reviewer feedback.
- **Never use top-level PR comments** (e.g., `gh pr comment`) to respond to review feedback.
- Use the PR review comment reply endpoint with the pull number to keep responses in-thread:
  - `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies`
- Do not create a new PR review when replying (avoid GraphQL review comment mutations).
- Include the relevant commit message(s) in replies to Gemini.

### Push Before Reply (CRITICAL)

**Never reply to reviewer comments referencing commits that are not yet pushed to remote.** Reviewers can only see commits that are visible on the remote branch. Before replying with "Fixed in commit X":

1. Push your commits first
2. Verify the push completed by checking local HEAD matches remote:

   ```bash
   BRANCH=$(git branch --show-current)
   git fetch origin "$BRANCH"
   [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/$BRANCH)" ] || echo "NOT PUSHED"
   ```

3. Only then reply to review comments

Replying before pushing creates confusion - reviewers see "Fixed in commit abc123" but cannot find that commit on the PR.

### Adding, modifying, or deleting a skill

Skills are version-controlled like any other file. Create, edit, or delete files in `.codex/skills/` and commit as normal.

## Script Naming

- Use camelCase for npm script names (e.g., `buildOpenapi` not `build:openapi`)

## TypeScript File Naming Conventions

### File Naming Rules

- **React components (.tsx)**: PascalCase (e.g., `ErrorBoundary.tsx`, `ContextMenu.tsx`)
- **TypeScript utilities (.ts)**: camelCase (e.g., `keyManager.ts`, `webCrypto.ts`)
- **Test files**: Match source file + `.test` (e.g., `keyManager.test.ts`, `ErrorBoundary.test.tsx`)
- **Type definitions (.d.ts)**: camelCase (e.g., `capacitorSqlite.d.ts`)
- **API routes**: camelCase (e.g., `postLogin.ts`, `getSessions.ts`)
- **Index/barrel files**: Keep as `index.ts`
- **Skills** (`.claude/skills/`, `.codex/skills/`): Keep kebab-case skill IDs (e.g., `commit-and-push`)

### Do NOT Use

- kebab-case for TypeScript source files (e.g., `key-manager.ts`)
- snake_case for TypeScript source files (e.g., `key_manager.ts`)

### Enforcement

File naming conventions are enforced via `scripts/checks/checkFileNames.sh` which runs in pre-push hooks and CI.

## Running Tests (CRITICAL: Use Headless Mode)

**ALWAYS run Maestro tests in headless mode** to prevent the simulator/emulator UI from interfering with agent workflows:

```bash
# iOS - headless mode
./scripts/runMaestroIosTests.sh --headless

# Android - headless mode
./scripts/runMaestroAndroidTests.sh --headless
```

The `--headless` flag:

- **iOS**: Boots the simulator via `simctl` without opening Simulator.app
- **Android**: Runs the emulator with `-no-window -no-audio -no-boot-anim`

**Never run Maestro tests without `--headless`** when running as an agent. The simulator/emulator window can steal focus, cause keyboard input issues, or hang waiting for user interaction.

## UI Guidelines

### Input Fields

- Use the shared `Input` component from `@/components/ui/input` for all form inputs
- Input fields must use `text-base` (16px) minimum font size to prevent iOS Safari auto-zoom on focus
- Never use `text-sm` or `text-xs` on input, textarea, or select elements

## React Guidelines

### Component Organization

- **One component per file** - Each React component must have its own file
- **Group by folder** - Group related components into folders. This is often by feature (e.g., `auth/`), but also useful for compound components (e.g., `context-menu/`)

  ```text
  src/
    features/
      auth/
        LoginForm.tsx
        LoginForm.test.tsx
    components/ui/
      context-menu/
        ContextMenu.tsx
        ContextMenu.test.tsx
        ContextMenuItem.tsx
        ContextMenuItem.test.tsx
        index.ts
  ```

- **Colocate tests** - Keep `.test.tsx` files next to their component files
- **Prefer folder entry points** - Use `index.ts` barrels for external imports and direct file imports within the folder
- **Split helper components** - If a `.tsx` file contains multiple top-level PascalCase JSX components, extract each extra component into its own `PascalCase.tsx`

### Component Guardrail

- `scripts/checks/checkOneComponentPerFile.ts` enforces one top-level React component per `.tsx` file
- Runs in pre-push via `.husky/pre-push`
- Current rollout is **phase 1**: checks newly added `.tsx` files in the push range to avoid blocking incremental legacy cleanup
- Escape hatch for rare cases: include `one-component-per-file: allow` in the file with a short rationale

### Refactoring

- **Keep test files in sync** - When renaming, moving, or deleting a component:
  - Rename/move/delete the corresponding `.test.tsx` file
  - Update any imports in the test file to reflect the new path
  - Ensure test file naming matches component file naming
