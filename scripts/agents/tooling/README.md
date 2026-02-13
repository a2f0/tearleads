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
- `replyToGemini` (reply in-thread with standardized commit-hash message)
- `replyToComment` (reply in-thread with custom body)

Options:

- `--title <value>`: optional for `setVscodeTitle` (defaults to `<workspace> - <branch>`)
- `--number <n>`: PR number for review comment actions
- `--comment-id <id>`: review comment database ID for reply actions
- `--commit <sha>`: commit SHA for `replyToGemini`
- `--body <text>`: custom comment body for `replyToComment`
- `--timeout-seconds <n>`: default `300`, default `3600` for `refresh`
- `--repo-root <path>`: force execution from a specific git repo root
- `--dry-run`: validate action/script resolution without executing target script
- `--json`: emit structured summary output

## Examples

```sh
./scripts/agents/tooling/agentTool.sh setVscodeTitle --title "tearleads6 - main"
./scripts/agents/tooling/agentTool.sh solicitCodexReview --dry-run --json
./scripts/agents/tooling/agentTool.sh replyToGemini --number 1618 --comment-id 2801563279 --commit d9948cca79f7f13c940edcade20b5665b1bf0762
./scripts/agents/tooling/agentTool.sh refresh
```
