# Agent Tool Wrappers (Phase 1)

`agentTool.sh` is a thin wrapper around `scripts/agents/*` commands for safer tool-calling.

## Usage

```sh
./scripts/agents/tooling/agentTool.sh <action> [options]
```

Actions:

- `refresh`
- `solicitClaudeCodeReview`
- `solicitCodexReview`
- `setVscodeTitle`

Options:

- `--title <value>`: optional for `setVscodeTitle` (defaults to `<workspace> - <branch>`)
- `--timeout-seconds <n>`: default `300`, default `3600` for `refresh`
- `--repo-root <path>`: force execution from a specific git repo root
- `--dry-run`: validate action/script resolution without executing target script
- `--json`: emit structured summary output

## Examples

```sh
./scripts/agents/tooling/agentTool.sh setVscodeTitle --title "tearleads6 - main"
./scripts/agents/tooling/agentTool.sh solicitCodexReview --dry-run --json
./scripts/agents/tooling/agentTool.sh refresh
```
