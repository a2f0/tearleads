---
description: Refresh Workspace
---

# Refresh Workspace

Run the workspace refresh script to update after a PR is merged.

```bash
./scripts/agents/tooling/agentTool.ts refresh
```

This script:

- Switches to main and pulls latest
- Installs pnpm dependencies
- Builds TypeScript packages
- Installs Ruby gems
- Installs CocoaPods using the committed `Podfile.lock`
- Clears queued status (resets VS Code title and tmux window)

Note: Refresh uses the committed `Podfile.lock` to restore to the known state. Clean CocoaPods installs (which regenerate `Podfile.lock`) belong in `/update-everything` when dependencies change.
