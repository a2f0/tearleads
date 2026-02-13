# Agent Tool-Calling Matrix

Date: 2026-02-12 (Phase 2 complete, Phase 4 planned)

Scope:

- `scripts/agents/*`
- `scripts/*`
- `.claude/commands/*` (skills)
- `CLAUDE.md`, `AGENTS.md`
- Excludes `scripts/bumpVersion.sh` (moving to CI in `#1569`)

Goal:

- Decide what should be wired as first-class tool calls vs kept as raw shell scripts.

## Recommendation Summary

1. Tool now:

- `scripts/agents/*` status/title helpers
- Local analysis/test helpers with bounded side effects

1. Tool later:

- Dev environment bootstrap/reset scripts
- Reviewer/automation helpers that touch GitHub but are operationally safe

1. Keep shell/manual (or hard-gated tools):

- Deploy/provisioning/secrets scripts
- Scripts with external infra mutation or high blast radius

1. Extract from skills (Phase 4):

- GitHub API patterns repeated across skills (`gh pr view`, GraphQL queries, CI status)
- Comment thread management (reply, resolve)
- Gemini interaction helpers

## Matrix

Legend:

- `Now`: promote to tool wrapper now
- `Later`: promote after wrapper framework is stable
- `Manual`: keep shell/manual or require explicit confirmation gate

### scripts/agents

| Script | Decision | Wrapped | Wrapper Notes |
| --- | --- | --- | --- |
| `scripts/agents/refresh.sh` | Now | ✅ | `agentTool.sh refresh` |
| `scripts/agents/setVscodeTitle.sh` | Now | ✅ | `agentTool.sh setVscodeTitle [--title <value>]` |
| `scripts/agents/title-lib.sh` | Manual | N/A | Library, not entrypoint |

### scripts

| Script | Decision | Wrapped | Wrapper Notes |
| --- | --- | --- | --- |
| `scripts/analyzeBundle.sh` | Now | Read-only artifact analysis | Capture summary JSON if possible |
| `scripts/checkBinaryFiles.sh` | Now | Guardrail validation | Read-only check mode |
| `scripts/checkPort.ts` | Now | Local environment check | Arg: port |
| `scripts/checkSmtpPort.ts` | Now | Local environment check | No args |
| `scripts/ciImpact/ciImpact.ts` | Now | Deterministic planning helper | Args passthrough, JSON output |
| `scripts/ciImpact/README.md` | Manual | Documentation, not executable | N/A |
| `scripts/ciImpact/job-groups.json` | Manual | Data/config, not executable | N/A |
| `scripts/ciImpact/runImpactedQuality.ts` | Now | Bounded CI helper | Explicit base/head args |
| `scripts/ciImpact/runImpactedTests.ts` | Now | Bounded CI helper | Explicit base/head args |
| `scripts/countLines.ts` | Now | Read-only utility | Output normalization |
| `scripts/dropPostgresDb.ts` | Later | Mutates local DB state | Require env + confirm flag |
| `scripts/killPnpmDev.ts` | Later | Stops local processes | Require target/scope args |
| `scripts/lib/pg-helpers.ts` | Manual | Library file, not entrypoint | N/A |
| `scripts/listAdmins.ts` | Later | External/system dependency | Read-only but env-sensitive |
| `scripts/runAllTests.sh` | Now | Standard validation entrypoint | Long timeout; stream summarized |
| `scripts/runElectronTests.sh` | Now | Standard validation entrypoint | Long timeout |
| `scripts/runMaestroAndroidTests.sh` | Later | Emulator/device dependency | Preflight check wrapper |
| `scripts/runMaestroIosTests.sh` | Later | Simulator/device dependency | Preflight check wrapper |
| `scripts/runPlaywrightTests.sh` | Now | Standard validation entrypoint | Arg: suite/filter |
| `scripts/solicitClaudeCodeReview.sh` | Later | External reviewer workflow | Keep explicit invocation |
| `scripts/solicitCodexReview.sh` | Later | External reviewer workflow | Keep explicit invocation |
| `scripts/syncCliAuth.sh` | Later | Auth/system side effects | Require explicit confirm flag |
| `scripts/toggleAndroidKeyboard.sh` | Later | Local device state mutation | Device preflight |
| `scripts/verifyBinaryGuardrails.sh` | Now | Safety check | Read-only mode default |
| `scripts/verifyCleanIosBuild.sh` | Later | Heavy, env-sensitive | Long timeout + preflight |
| `scripts/clearAndroidData.sh` | Manual | Destructive local reset | Explicit manual only |
| `scripts/clearAppData.sh` | Manual | Destructive local reset | Explicit manual only |
| `scripts/copyTestFilesAndroid.sh` | Later | Local test setup mutation | Safe with targeted args |
| `scripts/copyTestFilesIos.sh` | Later | Local test setup mutation | Safe with targeted args |
| `scripts/createAccount.ts` | Manual | Potential external state mutation | Keep explicit manual |
| `scripts/createTuxedoDeployKey.sh` | Manual | Secrets/key management | Hard-gated/manual |
| `scripts/deliverMail.sh` | Manual | External side effects | Hard-gated/manual |
| `scripts/deployApi.sh` | Manual | Production/deployment blast radius | Hard-gated/manual |
| `scripts/deployClient.sh` | Manual | Production/deployment blast radius | Hard-gated/manual |
| `scripts/deployWebsite.sh` | Manual | Production/deployment blast radius | Hard-gated/manual |
| `scripts/downloadSqliteWasm.sh` | Later | Download side effects | Cache + checksum wrapper |
| `scripts/downloadV86.sh` | Later | Download side effects | Cache + checksum wrapper |
| `scripts/makeAdmin.sh` | Manual | Privilege mutation | Hard-gated/manual |
| `scripts/muteIosSimulatorAudio.sh` | Later | Local simulator state mutation | Device preflight |
| `scripts/reinstallFromPlayStore.sh` | Manual | Device/account side effects | Hard-gated/manual |
| `scripts/resetAndroidEmulator.sh` | Manual | Destructive emulator reset | Manual only |
| `scripts/resetIosSimulator.sh` | Manual | Destructive simulator reset | Manual only |
| `scripts/runAndroid.sh` | Later | Device/runtime dependency | Preflight wrapper |
| `scripts/runAnsible.sh` | Manual | Infra mutation risk | Hard-gated/manual |
| `scripts/runAnsibleTuxedo.sh` | Manual | Infra mutation risk | Hard-gated/manual |
| `scripts/runElectron.sh` | Later | Local runtime helper | Optional tool after stabilization |
| `scripts/runIos.sh` | Later | Device/runtime dependency | Preflight wrapper |
| `scripts/runIpad.sh` | Later | Device/runtime dependency | Preflight wrapper |
| `scripts/runPostgresMigration.sh` | Manual | DB schema mutation | Hard-gated/manual |
| `scripts/selfHostedRunner.sh` | Manual | Runner/infra management | Hard-gated/manual |
| `scripts/setGithubVars.sh` | Manual | Secrets/org-repo setting mutation | Hard-gated/manual |
| `scripts/setTerraformCloudVars.sh` | Manual | Secrets/infra mutation | Hard-gated/manual |
| `scripts/setupPostgresDev.sh` | Later | Local env bootstrap with mutation | Safe with clear preflight |
| `scripts/setupSerenaMcp.sh` | Later | Local tooling bootstrap | Good candidate after wrappers |
| `scripts/setupTuxedoRepos.sh` | Later | Multi-repo local mutation | Safe with dry-run support |
| `scripts/tuxedo.sh` | Later | Orchestration helper | Wrapper with mode args |
| `scripts/tuxedoKill.sh` | Later | Process-control side effects | Scope args required |
| `scripts/updateEverything.sh` | Later | Broad dependency mutation | Explicit mode + dry-run first |
| `scripts/codex.sh` | Later | Agent bootstrap helper | Tool once interface stabilized |

Note:

- Duplicate entries were consolidated conceptually; decisions stay the same.

## Starter Wrapper Contract

Use a thin wrapper layer (MCP tool or shell adapter) with a stable interface per script.

Required behavior:

1. Fixed repo-root execution:

- Resolve workspace root and `cd` there before execution.

1. Explicit argument schema:

- Reject undeclared args.
- Prefer named args over raw command strings.

1. Safety class:

- `safe_read`, `safe_write_local`, `high_risk_external`.
- `high_risk_external` defaults to blocked unless explicitly enabled.

1. Timeouts:

- Default 5 min.
- Long-running tasks opt-in per script (15-60 min).

1. Output contract:

- Return structured summary: `status`, `exit_code`, `duration_ms`, `key_lines`.
- Suppress noisy success logs by default, keep stderr surfaced.

1. Idempotency/retry metadata:

- Mark wrappers as `retry_safe: true/false`.
- Queue/merge scripts should be retry-safe where practical.

1. Preflight checks:

- For GH scripts: verify repo via `gh repo view --json nameWithOwner -q .nameWithOwner`.
- For device scripts: verify emulator/simulator availability before run.
- For infra scripts: verify explicit enable flag.

1. Dry-run where possible:

- For mutating scripts, support `--dry-run` wrapper mode if script supports preview.

1. Audit tags:

- Include `invoked_by`, `skill_name`, and timestamp in wrapper logs for traceability.

## Suggested Rollout

Phase 1 (immediate): ✅ COMPLETE (PR #1571)

- Toolized all `scripts/agents/*` → `scripts/agents/tooling/agentTool.sh`
  - Actions: `refresh`, `setVscodeTitle`, `solicitCodexReview`, `solicitClaudeCodeReview`

Phase 2 (safe utilities): ✅ COMPLETE (PR #1596)

- Toolized safe utility scripts → `scripts/tooling/scriptTool.sh`
  - Actions: `analyzeBundle`, `checkBinaryFiles`, `ciImpact`, `runImpactedQuality`, `runImpactedTests`, `runAllTests`, `runElectronTests`, `runPlaywrightTests`, `verifyBinaryGuardrails`
- Updated `.claude/commands/optimize-test-execution.md` to prefer wrapper invocation

Phase 3 (env/device/bootstrap):

- Candidate scripts: `setupPostgresDev`, `setupSerenaMcp`, `runAndroid/iOS`, `verifyCleanIosBuild`, `updateEverything`
- Add preflight checks for device/simulator availability
- Keep deploy/secrets/infra scripts manual by policy, or add hard-gated wrappers only if required

Phase 4 (GitHub API patterns from skills): 🔄 IN PROGRESS (PR #1623)

- Extract repeated `gh` CLI and GraphQL patterns from skills into `agentTool.sh` actions
- ✅ High-priority actions implemented: `getPrInfo`, `getReviewThreads`, `replyToComment`, `resolveThread`, `getCiStatus`, `cancelWorkflow`, `rerunWorkflow`
- ✅ Medium-priority actions implemented: `downloadArtifact`, `enableAutoMerge`, `findPrForBranch`, `listHighPriorityPrs`, `triggerGeminiReview`, `findDeferredWork`
- ✅ Token Efficiency sections added to all 18 skills
- ⏳ Remaining: Update skills to use new wrappers
- See "Skill API Pattern Extraction" section below

## Wrapper Usage (Phase 1 + 2)

### Agent Workspace Tools (`agentTool.sh`)

```bash
# Set VS Code window title
./scripts/agents/tooling/agentTool.sh setVscodeTitle

# Refresh workspace (switch to main, pull latest)
./scripts/agents/tooling/agentTool.sh refresh

# Request code review from another agent
./scripts/agents/tooling/agentTool.sh solicitCodexReview
./scripts/agents/tooling/agentTool.sh solicitClaudeCodeReview
```

### CI/Testing Tools (`scriptTool.sh`)

```bash
# Analyze CI impact for changed files
./scripts/tooling/scriptTool.sh ciImpact --base origin/main --head HEAD --json

# Run quality checks on impacted files
./scripts/tooling/scriptTool.sh runImpactedQuality --base origin/main --head HEAD

# Run tests on impacted packages
./scripts/tooling/scriptTool.sh runImpactedTests --base origin/main --head HEAD

# Run full test suite
./scripts/tooling/scriptTool.sh runAllTests

# Run E2E tests
./scripts/tooling/scriptTool.sh runPlaywrightTests --filter "login" --headed
./scripts/tooling/scriptTool.sh runElectronTests --file tests/smoke.spec.ts

# Check binary files in staged changes
./scripts/tooling/scriptTool.sh checkBinaryFiles --staged --json

# Verify binary guardrail configuration
./scripts/tooling/scriptTool.sh verifyBinaryGuardrails --json
```

### Common Options

Both wrappers support:

- `--timeout-seconds <n>` - Override default timeout
- `--repo-root <path>` - Execute from specific git root
- `--dry-run` - Validate without executing
- `--json` - Emit structured JSON summary

## Skill API Pattern Extraction (Phase 4)

Raw `gh` CLI and GraphQL patterns found in `.claude/commands/` skills that should be extracted into `agentTool.sh` actions for consistency, token efficiency, and error handling.

### High Priority (cross-skill patterns)

| Pattern | Skills Using It | Proposed Action | Args |
| --- | --- | --- | --- |
| Get PR info | solicit-gemini-review, fix-tests, address-gemini-feedback, follow-up-with-gemini, enter-merge-queue, commit-and-push | `agentTool.sh getPrInfo` | `[--fields <comma-sep>]` |
| Get review threads (GraphQL) | address-gemini-feedback, follow-up-with-gemini | `agentTool.sh getReviewThreads` | `--pr <number> [--unresolved-only]` |
| Reply to Gemini feedback in-thread (commit-hash template) | follow-up-with-gemini, enter-merge-queue, address-gemini-feedback | `agentTool.sh replyToGemini` | `--number <pr> --comment-id <id> --commit <sha>` |
| Reply to PR comment in-thread (custom body) | follow-up-with-gemini, enter-merge-queue | `agentTool.sh replyToComment` | `--number <pr> --comment-id <id> --body <message>` |
| Resolve review thread | follow-up-with-gemini | `agentTool.sh resolveThread` | `--thread-id <id>` |
| Get CI run/job status | fix-tests, enter-merge-queue | `agentTool.sh getCiStatus` | `[--commit <sha>] [--run-id <id>]` |
| Cancel workflow run | fix-tests, enter-merge-queue | `agentTool.sh cancelWorkflow` | `--run-id <id>` |
| Rerun workflow | fix-tests, enter-merge-queue | `agentTool.sh rerunWorkflow` | `--run-id <id>` |

### Medium Priority (single-skill but complex)

| Pattern | Skill | Proposed Action | Args |
| --- | --- | --- | --- |
| Download CI artifact | fix-tests | `agentTool.sh downloadArtifact` | `--run-id <id> --name <artifact> --dest <path>` |
| Enable auto-merge | enter-merge-queue | `agentTool.sh enableAutoMerge` | `--pr <number>` |
| Find PR for branch | enter-merge-queue | `agentTool.sh findPrForBranch` | `--branch <name> [--state <open\|merged>]` |
| List high-priority PRs | enter-merge-queue | `agentTool.sh listHighPriorityPrs` | (none) |
| Post Gemini review + poll | solicit-gemini-review | `agentTool.sh triggerGeminiReview` | `--pr <number> [--timeout <seconds>]` |
| Find deferred work in PR | preen-deferred-fixes | `agentTool.sh findDeferredWork` | `--pr <number>` |

### Benefits of Extraction

1. **Token efficiency**: Wrappers use `--json` with minimal fields, suppress verbose output
2. **Repo handling**: Auto-resolve repo via `gh repo view --json nameWithOwner`; no repeated boilerplate
3. **Error handling**: Consistent exit codes, structured error messages
4. **GraphQL simplification**: No temp-file workarounds for complex queries
5. **Audit trail**: Wrapper logs include `invoked_by`, timestamp for traceability

### Implementation Notes

- Add new actions to `scripts/agents/tooling/agentTool.sh`
- Each action follows the existing wrapper contract (structured JSON output, timeouts, dry-run support)
- Update skills to use wrappers after implementation
- GraphQL queries can be embedded in the wrapper script (no temp file needed)
