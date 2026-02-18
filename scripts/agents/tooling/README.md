# Agent Tool Wrappers

`agentTool.ts` is a TypeScript CLI wrapper around `scripts/agents/*` commands and GitHub API actions for safer tool-calling with strong typing.

## Usage

```sh
./scripts/agents/tooling/agentTool.ts <action> [options]
```

Run `--help` for full action and option list:

```sh
./scripts/agents/tooling/agentTool.ts --help
./scripts/agents/tooling/agentTool.ts <action> --help
```

## Actions

### Script Wrappers

- `refresh` - Switch to main, pull, install, build
- `syncToolchainVersions` - Run toolchain sync checks/updates (Node/Electron + Android SDK)
- `setVscodeTitle` - Set VS Code window title
- `solicitClaudeCodeReview` - Request Claude Code review
- `solicitCodexReview` - Request Codex review
- `addLabel` - Add label to PR/issue
- `approveSkippedChecks` - Create passing check runs for skipped CI
- `tagPrWithTuxedoInstance` - Tag PR with workspace instance label

### GitHub API Actions

- `getRepo` - Print current repo as `owner/name`
- `checkMainVersionBumpSetup` - Validate required env vars, key file, and repo secrets for main version bump app auth
- `getPrInfo` - Get PR info (state, merge status, etc.)
- `getReviewThreads` - Fetch review threads via GraphQL
- `replyToComment` - Reply in-thread with custom body
- `replyToGemini` - Reply in-thread with commit-hash message
- `resolveThread` - Resolve a review thread
- `getCiStatus` - Get workflow run status
- `cancelWorkflow` - Cancel a workflow run
- `rerunWorkflow` - Rerun a workflow
- `downloadArtifact` - Download CI artifact
- `enableAutoMerge` - Enable auto-merge on PR
- `findPrForBranch` - Find PR for a branch
- `listHighPriorityPrs` - List open high-priority PRs
- `triggerGeminiReview` - Post /gemini review and poll for response
- `checkGeminiQuota` - Detect Gemini daily quota exhaustion across PR review surfaces
- `findDeferredWork` - Find deferred work comments
- `listDeferredFixIssues` - List deferred-fix issues
- `getIssue` - Fetch issue details by number
- `issueTemplate` - Print standard issue body template
- `createIssue` - Create user-requested/deferred-fix issues with dedupe checks
- `verifyBranchPush` - Verify local HEAD is pushed to `origin/<branch>`
- `sanitizePrBody` - Remove auto-close directives and return extracted issue numbers
- `createDeferredFixIssue` - Create deferred-fix issue from structured review items
- `updatePrBody` - Update PR body from inline text or a file

## Skill Coverage

Automation skills call most `agentTool.ts` actions directly. Two wrappers are intentionally manual-only:

- `syncToolchainVersions` (operator toolchain maintenance workflow)
- `approveSkippedChecks` (manual CI recovery when checks are skipped by routing)

## Common Options

- `--timeout-seconds <n>` - Timeout (default: 300, refresh: 3600)
- `--repo-root <path>` - Execute from specific git repo root
- `--dry-run` - Validate without executing
- `--json` - Emit structured JSON summary

## Authentication

Actions migrated to Octokit currently require `GITHUB_TOKEN` (or `GH_TOKEN`) in
the environment. If those env vars are unset, `agentTool` falls back to the
logged-in GitHub CLI token via `gh auth token`.

Precedence:
1. `GITHUB_TOKEN`
2. `GH_TOKEN`
3. `gh auth token`

Existing `gh`-backed actions continue to use `gh` authentication directly.

## Examples

```sh
./scripts/agents/tooling/agentTool.ts setVscodeTitle --title "tearleads6 - main"
./scripts/agents/tooling/agentTool.ts syncToolchainVersions --check --max-android-jump 1
./scripts/agents/tooling/agentTool.ts solicitCodexReview --dry-run --json
./scripts/agents/tooling/agentTool.ts replyToGemini --number 1618 --comment-id 2801563279 --commit d9948cca79f7f13c940edcade20b5665b1bf0762
./scripts/agents/tooling/agentTool.ts triggerGeminiReview --number 1651 --poll-timeout 120 --json
./scripts/agents/tooling/agentTool.ts getRepo
./scripts/agents/tooling/agentTool.ts createIssue --type user-requested --title "feat: add x" --search "add x"
./scripts/agents/tooling/agentTool.ts createIssue --type deferred-fix --title "chore: deferred fix from PR #123" --source-pr 123 --review-thread-url "https://github.com/org/repo/pull/123#discussion_r1"
./scripts/agents/tooling/agentTool.ts verifyBranchPush --branch my-feature-branch
./scripts/agents/tooling/agentTool.ts sanitizePrBody --number 123
./scripts/agents/tooling/agentTool.ts createDeferredFixIssue --number 123 --pr-url "https://github.com/org/repo/pull/123" --deferred-items-json '[{"body":"Handle edge case","path":"src/x.ts","line":42,"html_url":"https://github.com/org/repo/pull/123#discussion_r1"}]'
./scripts/agents/tooling/agentTool.ts updatePrBody --number 123 --body-file /tmp/pr-body.md
./scripts/agents/tooling/agentTool.ts refresh
```
