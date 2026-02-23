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
- `verifyFileGuardrails` - Verify file guardrail configuration

### Device

- `copyTestFilesAndroid` - Copy .test_files payload into Android emulator storage
- `copyTestFilesIos` - Copy .test_files payload into iOS simulator app container
- `runAndroid` - Build/sync and run Android app on emulator
- `runIos` - Build/sync and run iOS app on simulator
- `runIpad` - Build/sync and run iOS app on iPad simulator
- `runElectron` - Start Electron development runtime
- `toggleAndroidKeyboard` - Toggle Android emulator software keyboard visibility
- `verifyCleanIosBuild` - Clean iOS build artifacts and verify workspace cleanliness
- `muteIosSimulatorAudio` - Mute iOS simulator audio output

### Environment

- `setupPostgresDev` - Install/start local PostgreSQL and provision dev DB
- `setupSerenaMcp` - Configure Serena MCP server for Codex and Claude
- `setupTuxedoRepos` - Clone/fetch local tuxedo workspace repositories
- `updateEverything` - Run repository-wide dependency and validation refresh

### Operations

- `syncCliAuth` - Sync local Claude/Codex auth credentials to remote host
- `tuxedo` - Launch tuxedo tmux workspace manager with explicit mode
- `tuxedoKill` - Terminate tuxedo resources (scope flag required)

### Quality

- `runImpactedQuality` - Run quality checks on impacted files only

### Testing

- `runImpactedTests` - Run impacted ciImpact script tests and coverage tests
- `runAllTests` - Run full test suite (lint, build, unit, e2e)
- `runElectronTests` - Run Electron E2E tests
- `runPlaywrightTests` - Run Playwright E2E tests
- `runMaestroAndroidTests` - Run Maestro Android flows via Fastlane
- `runMaestroIosTests` - Run Maestro iOS flows via Fastlane

## Skill Coverage

Automation skills currently invoke a focused subset of wrappers:

- Skill-invoked: `ciImpact`, `runImpactedQuality`, `runImpactedTests`
- Manual-only: `analyzeBundle`, `checkBinaryFiles`, `copyTestFilesAndroid`, `copyTestFilesIos`, `runAllTests`, `runElectronTests`, `runPlaywrightTests`, `verifyFileGuardrails`, `runAndroid`, `runIos`, `runIpad`, `runElectron`, `runMaestroAndroidTests`, `runMaestroIosTests`, `setupPostgresDev`, `setupSerenaMcp`, `setupTuxedoRepos`, `syncCliAuth`, `toggleAndroidKeyboard`, `tuxedo`, `tuxedoKill`, `updateEverything`, `verifyCleanIosBuild`, `muteIosSimulatorAudio`

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

### copyTestFilesIos

| Option | Description | Required |
| ------ | ----------- | -------- |
| `--bundle-id <id>` | Bundle ID (default: com.tearleads.app) | No |

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
| `--scripts-only` | Run only impacted ciImpact script tests | No |

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

### runIos

| Option | Description | Required |
| ------ | ----------- | -------- |
| `--device <name>` | Simulator device name | No |

### runMaestroAndroidTests

| Option | Description | Required |
| ------ | ----------- | -------- |
| `--headless` | Run emulator without UI | No |
| `--flow <path>` | Flow file path to execute | No |
| `--record-video` | Enable Maestro video recording | No |
| `--video-seconds <n>` | Video duration in seconds | No |

### runMaestroIosTests

| Option | Description | Required |
| ------ | ----------- | -------- |
| `--headless` | Run simulator headless | No |
| `--flow <path>` | Flow file path to execute | No |
| `--record-video` | Enable Maestro video recording | No |

### setupSerenaMcp

| Option | Description | Required |
| ------ | ----------- | -------- |
| `--script-dry-run` | Pass through --dry-run to setupSerenaMcp.sh | No |

### setupTuxedoRepos

| Option | Description | Required |
| ------ | ----------- | -------- |
| `--base-dir <path>` | Set TUXEDO_BASE_DIR for this run | No |
| `--workspace-count <n>` | Set TUXEDO_WORKSPACE_COUNT for this run | No |

### syncCliAuth

| Option | Description | Required |
| ------ | ----------- | -------- |
| `--host <user@host>` | Remote host destination | Yes |
| `--confirm` | Explicitly allow credential sync | Yes |

### tuxedo

| Option | Description | Required |
| ------ | ----------- | -------- |
| `--mode <default\|no-pr-dashboards\|no-screen>` | Tuxedo launch mode | Yes |
| `--base-dir <path>` | Set TUXEDO_BASE_DIR for this run | No |
| `--workspace-count <n>` | Set TUXEDO_WORKSPACES for this run | No |

### tuxedoKill

| Option | Description | Required |
| ------ | ----------- | -------- |
| `--scope <all>` | Kill scope (currently only all) | Yes |
| `--confirm` | Explicitly allow tuxedo termination | Yes |

### updateEverything

| Option | Description | Required |
| ------ | ----------- | -------- |
| `--mode <full\|quick>` | Execution profile | Yes |
| `--confirm` | Required when executing without --dry-run | No |

## Default Timeouts

| Action | Timeout |
| ------ | ------- |
| `analyzeBundle` | 10 minutes |
| `checkBinaryFiles` | 5 minutes |
| `ciImpact` | 5 minutes |
| `copyTestFilesAndroid` | 5 minutes |
| `copyTestFilesIos` | 5 minutes |
| `runImpactedQuality` | 5 minutes |
| `runImpactedTests` | 5 minutes |
| `runAllTests` | 1 hour |
| `runElectronTests` | 30 minutes |
| `runPlaywrightTests` | 30 minutes |
| `verifyFileGuardrails` | 5 minutes |
| `runAndroid` | 1.5 hours |
| `runIos` | 1.5 hours |
| `runIpad` | 1.5 hours |
| `runElectron` | 1 hour |
| `runMaestroAndroidTests` | 1 hour |
| `runMaestroIosTests` | 1 hour |
| `setupPostgresDev` | 20 minutes |
| `setupSerenaMcp` | 10 minutes |
| `setupTuxedoRepos` | 30 minutes |
| `syncCliAuth` | 10 minutes |
| `toggleAndroidKeyboard` | 2 minutes |
| `tuxedo` | 20 minutes |
| `tuxedoKill` | 5 minutes |
| `updateEverything` | 2 hours |
| `verifyCleanIosBuild` | 30 minutes |
| `muteIosSimulatorAudio` | 2 minutes |

## Safety Classes

- `safe_read`: read-only checks and analysis (no local/remote mutations)
- `safe_write_local`: mutates local workspace/device state only
- `safe_write_remote`: may mutate remote systems/accounts and requires explicit confirmation

| Class | Actions |
| ----- | ------- |
| `safe_read` | `checkBinaryFiles`, `ciImpact`, `verifyFileGuardrails` |
| `safe_write_local` | `analyzeBundle`, `copyTestFilesAndroid`, `copyTestFilesIos`, `runImpactedQuality`, `runImpactedTests`, `runAllTests`, `runElectronTests`, `runPlaywrightTests`, `runAndroid`, `runIos`, `runIpad`, `runElectron`, `runMaestroAndroidTests`, `runMaestroIosTests`, `setupPostgresDev`, `setupSerenaMcp`, `setupTuxedoRepos`, `toggleAndroidKeyboard`, `tuxedo`, `tuxedoKill`, `updateEverything`, `verifyCleanIosBuild`, `muteIosSimulatorAudio` |
| `safe_write_remote` | `syncCliAuth` |

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

# Run iOS launch wrapper with explicit simulator
./scripts/tooling/scriptTool.ts runIos --device "iPhone 16 Pro" --dry-run --json

# Preview update-everything quick mode
./scripts/tooling/scriptTool.ts updateEverything --mode quick --dry-run --json

# Sync CLI auth (requires explicit confirmation)
./scripts/tooling/scriptTool.ts syncCliAuth --host ubuntu@tuxedo.example.com --confirm
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
