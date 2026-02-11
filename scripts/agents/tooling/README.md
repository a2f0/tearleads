# Agent Tool Wrappers (Phase 1)

`agentTool.sh` is a thin wrapper around `scripts/agents/*` commands for safer tool-calling.

## Usage

```sh
./scripts/agents/tooling/agentTool.sh <action> [options]
```

Actions:

- `cleanup`
- `clearQueued`
- `clearStatus`
- `refresh`
- `solicitClaudeCodeReview`
- `solicitCodexReview`
- `setQueued`
- `setReady`
- `setWaiting`
- `setWorking`
- `setVscodeTitle`

Options:

- `--title <value>`: required for `setQueued` and `setVscodeTitle`
- `--timeout-seconds <n>`: default `300`, default `3600` for `refresh`
- `--repo-root <path>`: force execution from a specific git repo root
- `--dry-run`: validate action/script resolution without executing target script
- `--json`: emit structured summary output

## Examples

```sh
./scripts/agents/tooling/agentTool.sh setQueued --title "(queued) #1570 - chore/phase1"
./scripts/agents/tooling/agentTool.sh clearQueued --json
./scripts/agents/tooling/agentTool.sh setVscodeTitle --title "rapid6 - main"
./scripts/agents/tooling/agentTool.sh solicitCodexReview --dry-run --json
```
