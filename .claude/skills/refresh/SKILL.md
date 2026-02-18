---
name: refresh
description: Run the workspace refresh script to update after a PR is merged.
---


# Refresh Workspace

Run the workspace refresh script to update after a PR is merged.

## Workflow

```bash
./scripts/agents/tooling/agentTool.ts refresh
```

This script:

- Switches to main and pulls latest
- Installs pnpm dependencies
- Builds TypeScript packages
- Installs Ruby gems
- Clean installs CocoaPods (removes `Pods/` and `Podfile.lock`, runs `pod install --repo-update`)
- Clears queued status (resets VS Code title and tmux window)

The clean CocoaPods install ensures fresh native dependencies and prevents stale xcframework caches from causing build failures when native libraries are updated in merged PRs.
