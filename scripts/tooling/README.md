# Script Tool Wrappers (Phase 2)

`scriptTool.ts` is a thin wrapper around utility scripts in `scripts/` for safer tool-calling.

## Usage

```sh
./scripts/tooling/scriptTool.ts <action> [options]
```

## Actions

### Read-only / Analysis

- `analyzeBundle` - Build and open bundle analysis report
- `checkBinaryFiles` - Check for binary files (guardrail validation)
- `ciImpact` - Analyze CI impact for changed files (JSON output)
- `verifyBinaryGuardrails` - Verify binary guardrail configuration

### Quality / Testing

- `runImpactedQuality` - Run quality checks on impacted files only
- `runImpactedTests` - Run tests on impacted packages only
- `runAllTests` - Run full test suite (lint, build, unit, e2e)
- `runElectronTests` - Run Electron E2E tests
- `runPlaywrightTests` - Run Playwright E2E tests

## Options

- `--base <sha>` - Base commit for diff (required for ciImpact, runImpactedQuality, runImpactedTests)
- `--head <sha>` - Head commit for diff (required for ciImpact, runImpactedQuality, runImpactedTests)
- `--staged` - Check staged files (checkBinaryFiles, one of --staged or --from-upstream required)
- `--from-upstream` - Check files changed from upstream (checkBinaryFiles)
- `--headed` - Run tests with visible browser (runAllTests, runPlaywrightTests, runElectronTests)
- `--filter <pattern>` - Test filter pattern (runPlaywrightTests, runElectronTests)
- `--file <path>` - Specific test file (runPlaywrightTests, runElectronTests)
- `--timeout-seconds <n>` - Override default timeout (all actions)
- `--repo-root <path>` - Force execution from specific git root (all actions)
- `--dry-run` - Validate without executing (all actions)
- `--json` - Emit structured JSON summary (all actions)

## Default Timeouts

- `runAllTests` - 60 minutes
- `runElectronTests`, `runPlaywrightTests` - 30 minutes
- `analyzeBundle` - 10 minutes
- All others - 5 minutes

## Safety Classes

- `safe_read` - ciImpact, checkBinaryFiles, verifyBinaryGuardrails
- `safe_write_local` - All others (local filesystem/process changes only)

## Examples

```sh
# Analyze CI impact between commits
./scripts/tooling/scriptTool.ts ciImpact --base origin/main --head HEAD --json

# Run impacted quality checks
./scripts/tooling/scriptTool.ts runImpactedQuality --base origin/main --head HEAD

# Run impacted tests only
./scripts/tooling/scriptTool.ts runImpactedTests --base origin/main --head HEAD

# Check for binary files in staged changes
./scripts/tooling/scriptTool.ts checkBinaryFiles --staged --json

# Run Playwright tests with filter
./scripts/tooling/scriptTool.ts runPlaywrightTests --filter "login" --headed

# Dry-run to validate command
./scripts/tooling/scriptTool.ts runAllTests --dry-run --json
```

## JSON Output Format

When `--json` is specified, output includes:

```json
{
  "status": "success",
  "exit_code": 0,
  "duration_ms": 1234,
  "action": "ciImpact",
  "repo_root": "/path/to/repo",
  "safety_class": "safe_read",
  "retry_safe": true,
  "dry_run": false,
  "key_lines": ["last", "few", "lines", "of", "output"]
}
```
