# Agent Tool-Calling Matrix

Date: 2026-02-12 (Phase 2 complete)

Scope:

- `scripts/agents/*`
- `scripts/*`
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
| `scripts/analyzeBundle.sh` | Now | ✅ | `scriptTool.sh analyzeBundle` |
| `scripts/checkBinaryFiles.sh` | Now | ✅ | `scriptTool.sh checkBinaryFiles --staged\|--from-upstream` |
| `scripts/checkPort.ts` | Now | | Arg: port |
| `scripts/checkSmtpPort.ts` | Now | | No args |
| `scripts/ciImpact/ciImpact.ts` | Now | ✅ | `scriptTool.sh ciImpact --base <sha> --head <sha>` |
| `scripts/ciImpact/README.md` | Manual | N/A | Documentation, not executable |
| `scripts/ciImpact/job-groups.json` | Manual | N/A | Data/config, not executable |
| `scripts/ciImpact/runImpactedQuality.ts` | Now | ✅ | `scriptTool.sh runImpactedQuality --base <sha> --head <sha>` |
| `scripts/ciImpact/runImpactedTests.ts` | Now | ✅ | `scriptTool.sh runImpactedTests --base <sha> --head <sha>` |
| `scripts/countLines.ts` | Now | | Output normalization |
| `scripts/dropPostgresDb.ts` | Later | | Require env + confirm flag |
| `scripts/killPnpmDev.ts` | Later | | Require target/scope args |
| `scripts/lib/pg-helpers.ts` | Manual | N/A | Library file, not entrypoint |
| `scripts/listAdmins.ts` | Later | | Read-only but env-sensitive |
| `scripts/rebuildSqliteForVitest.sh` | Later | | Use only in test-repair flows |
| `scripts/runAllTests.sh` | Now | ✅ | `scriptTool.sh runAllTests [--headed]` |
| `scripts/runElectronTests.sh` | Now | ✅ | `scriptTool.sh runElectronTests [--headed] [--filter <pattern>] [--file <path>]` |
| `scripts/runMaestroAndroidTests.sh` | Later | | Preflight check wrapper |
| `scripts/runMaestroIosTests.sh` | Later | | Preflight check wrapper |
| `scripts/runPlaywrightTests.sh` | Now | ✅ | `scriptTool.sh runPlaywrightTests [--headed] [--filter <pattern>] [--file <path>]` |
| `scripts/solicitClaudeCodeReview.sh` | Now | ✅ | `agentTool.sh solicitClaudeCodeReview` |
| `scripts/solicitCodexReview.sh` | Now | ✅ | `agentTool.sh solicitCodexReview` |
| `scripts/syncCliAuth.sh` | Later | | Require explicit confirm flag |
| `scripts/toggleAndroidKeyboard.sh` | Later | | Device preflight |
| `scripts/verifyBinaryGuardrails.sh` | Now | ✅ | `scriptTool.sh verifyBinaryGuardrails` |
| `scripts/verifyCleanIosBuild.sh` | Later | | Long timeout + preflight |
| `scripts/clearAndroidData.sh` | Manual | N/A | Destructive local reset |
| `scripts/clearAppData.sh` | Manual | N/A | Destructive local reset |
| `scripts/copyTestFilesAndroid.sh` | Later | | Safe with targeted args |
| `scripts/copyTestFilesIos.sh` | Later | | Safe with targeted args |
| `scripts/createAccount.ts` | Manual | N/A | Potential external state mutation |
| `scripts/createTuxedoDeployKey.sh` | Manual | N/A | Secrets/key management |
| `scripts/deliverMail.sh` | Manual | N/A | External side effects |
| `scripts/deployApi.sh` | Manual | N/A | Production/deployment blast radius |
| `scripts/deployClient.sh` | Manual | N/A | Production/deployment blast radius |
| `scripts/deployWebsite.sh` | Manual | N/A | Production/deployment blast radius |
| `scripts/downloadSqliteWasm.sh` | Later | | Cache + checksum wrapper |
| `scripts/downloadV86.sh` | Later | | Cache + checksum wrapper |
| `scripts/makeAdmin.sh` | Manual | N/A | Privilege mutation |
| `scripts/muteIosSimulatorAudio.sh` | Later | | Device preflight |
| `scripts/reinstallFromPlayStore.sh` | Manual | N/A | Device/account side effects |
| `scripts/resetAndroidEmulator.sh` | Manual | N/A | Destructive emulator reset |
| `scripts/resetIosSimulator.sh` | Manual | N/A | Destructive simulator reset |
| `scripts/runAndroid.sh` | Later | | Preflight wrapper |
| `scripts/runAnsible.sh` | Manual | N/A | Infra mutation risk |
| `scripts/runAnsibleTuxedo.sh` | Manual | N/A | Infra mutation risk |
| `scripts/runElectron.sh` | Later | | Optional tool after stabilization |
| `scripts/runIos.sh` | Later | | Preflight wrapper |
| `scripts/runIpad.sh` | Later | | Preflight wrapper |
| `scripts/runPostgresMigration.sh` | Manual | N/A | DB schema mutation |
| `scripts/selfHostedRunner.sh` | Manual | N/A | Runner/infra management |
| `scripts/setGithubVars.sh` | Manual | N/A | Secrets/org-repo setting mutation |
| `scripts/setTerraformCloudVars.sh` | Manual | N/A | Secrets/infra mutation |
| `scripts/setupPostgresDev.sh` | Later | | Safe with clear preflight |
| `scripts/setupSerenaMcp.sh` | Later | | Good candidate after wrappers |
| `scripts/setupTuxedoRepos.sh` | Later | | Safe with dry-run support |
| `scripts/tuxedo.sh` | Later | | Wrapper with mode args |
| `scripts/tuxedoKill.sh` | Later | | Scope args required |
| `scripts/updateEverything.sh` | Later | | Explicit mode + dry-run first |
| `scripts/codex.sh` | Later | | Tool once interface stabilized |

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
