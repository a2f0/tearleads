# Refresh Workspace

Run the workspace refresh script to update after a PR is merged.

```bash
./scripts/agents/refresh.sh
```

This script:

- Switches to main and pulls latest
- Installs pnpm dependencies
- Builds TypeScript packages
- Installs Ruby gems
- Updates CocoaPods
- Clears queued status (resets VS Code title and tmux window)
