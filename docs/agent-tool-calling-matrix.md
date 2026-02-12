# Agent Tool-Calling Matrix

Date: 2026-02-11

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

| Script | Decision | Why | Wrapper Notes |
| --- | --- | --- | --- |
| `scripts/agents/refresh.sh` | Now | Common post-merge sync op | No args; long timeout |
| `scripts/agents/setVscodeTitle.sh` | Now | Shared primitive | Optional `title` (defaults to `<workspace> - <branch>`) |
| `scripts/agents/title-lib.sh` | Manual | Library, not entrypoint | N/A |

### scripts

| Script | Decision | Why | Wrapper Notes |
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
| `scripts/rebuildSqliteForVitest.sh` | Later | Build-time local mutation | Use only in test-repair flows |
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

Phase 1 (immediate): ✅ COMPLETE

- Toolize all `scripts/agents/*` → `scripts/agents/tooling/agentTool.sh` (PR #1571)
  - Actions: `refresh`, `setVscodeTitle`, `solicitCodexReview`, `solicitClaudeCodeReview`
- Toolize `analyzeBundle`, `checkBinaryFiles`, `ciImpact/*`, `runAllTests`, `runPlaywrightTests`, `runElectronTests`, `verifyBinaryGuardrails` → `scripts/tooling/scriptTool.sh` (PR #1596)
  - Actions: `analyzeBundle`, `checkBinaryFiles`, `ciImpact`, `runImpactedQuality`, `runImpactedTests`, `runAllTests`, `runElectronTests`, `runPlaywrightTests`, `verifyBinaryGuardrails`

Phase 2:

- Toolize local bootstrap/test env scripts (`setup*`, `runAndroid/iOS`, `verifyCleanIosBuild`, reviewer solicitation scripts).

Phase 3:

- Keep deploy/secrets/infra scripts manual by policy, or add hard-gated wrappers only if required.

## Wrapper Usage

### Phase 1: Agent Workspace Tools

```bash
# Set VS Code window title
./scripts/agents/tooling/agentTool.sh setVscodeTitle

# Refresh workspace (switch to main, pull latest)
./scripts/agents/tooling/agentTool.sh refresh

# Request code review from another agent
./scripts/agents/tooling/agentTool.sh solicitCodexReview
./scripts/agents/tooling/agentTool.sh solicitClaudeCodeReview
```

### Phase 1: CI/Testing Tools

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
