# Script Tool Wrappers

> **Auto-generated from `scriptTool.ts`** - Do not edit manually.
> Run `./scripts/tooling/scriptTool.ts generateDocs` to regenerate.

`scriptTool.ts` is a TypeScript wrapper around utility scripts in `scripts/` for safer tool-calling.

## Usage

```sh
./scripts/tooling/scriptTool.ts <action> [options]
```

## Actions

### Analysis

- `analyzeBundle` - Build and open bundle analysis report
- `checkBinaryFiles` - Check for binary files (guardrail validation)
- `ciImpact` - Analyze CI impact for changed files (JSON output)
- `verifyBinaryGuardrails` - Verify binary guardrail configuration

### Quality

- `runImpactedQuality` - Run quality checks on impacted files only

### Testing

- `runImpactedTests` - Run tests on impacted packages only
- `runAllTests` - Run full test suite (lint, build, unit, e2e)
- `runElectronTests` - Run Electron E2E tests
- `runPlaywrightTests` - Run Playwright E2E tests

## Common Options

All actions support these options:

| Option | Description |
| ------ | ----------- |
| `--timeout-seconds <n>` | Override default timeout |
| `--repo-root <path>` | Execute from specific git root |
| `--dry-run` | Validate without executing |
| `--json` | Emit structured JSON summary |

## Action-Specific Options

### checkBinaryFiles

| Option | Description | Required |
| ------ | ----------- | -------- |
| `--staged` | Check staged files | No |
| `--from-upstream` | Check files changed from upstream | No |

### ciImpact

| Option | Description | Required |
| ------ | ----------- | -------- |
| `--base <sha>` | Base commit for diff | Yes |
| `--head <sha>` | Head commit for diff | Yes |

### runImpactedQuality

| Option | Description | Required |
| ------ | ----------- | -------- |
| `--base <sha>` | Base commit for diff | Yes |
| `--head <sha>` | Head commit for diff | Yes |

### runImpactedTests

| Option | Description | Required |
| ------ | ----------- | -------- |
| `--base <sha>` | Base commit for diff | Yes |
| `--head <sha>` | Head commit for diff | Yes |

### runAllTests

| Option | Description | Required |
| ------ | ----------- | -------- |
| `--headed` | Run tests with visible browser | No |

### runElectronTests

| Option | Description | Required |
| ------ | ----------- | -------- |
| `--headed` | Run tests with visible browser | No |
| `--filter <pattern>` | Test filter pattern | No |
| `--file <path>` | Specific test file | No |

### runPlaywrightTests

| Option | Description | Required |
| ------ | ----------- | -------- |
| `--headed` | Run tests with visible browser | No |
| `--filter <pattern>` | Test filter pattern | No |
| `--file <path>` | Specific test file | No |

## Default Timeouts

| Action | Timeout |
| ------ | ------- |
| `analyzeBundle` | 10 minutes |
| `checkBinaryFiles` | 5 minutes |
| `ciImpact` | 5 minutes |
| `runImpactedQuality` | 5 minutes |
| `runImpactedTests` | 5 minutes |
| `runAllTests` | 1 hour |
| `runElectronTests` | 30 minutes |
| `runPlaywrightTests` | 30 minutes |
| `verifyBinaryGuardrails` | 5 minutes |

## Safety Classes

| Class | Actions |
| ----- | ------- |
| `safe_read` | `checkBinaryFiles`, `ciImpact`, `verifyBinaryGuardrails` |
| `safe_write_local` | `analyzeBundle`, `runImpactedQuality`, `runImpactedTests`, `runAllTests`, `runElectronTests`, `runPlaywrightTests` |

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
