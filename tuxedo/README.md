# Tuxedo

Tmux session manager for rapid development with persistent screen sessions and version manager support.

## Quick Start

```bash
# Start tuxedo (creates tmux session with all workspaces)
./tuxedo.sh

# Kill everything (neovim, screen sessions, tmux)
./tuxedoKill.sh
```

## Features

- **Multi-workspace tmux session** - Creates windows for rapid-main and rapid2-20
- **Persistent screen sessions** - Processes survive tmux kills; reattaches on restart
- **Version manager support** - Properly initializes rbenv, pyenv, and nvm
- **Ghostty integration** - Auto-launches in Ghostty terminal if not in a TTY
- **VS Code title sync** - Tmux window names reflect VS Code window titles
- **Shared resources** - Symlinks `.secrets/` and `.test_files/` across workspaces

## Configuration

Environment variables:

| Variable            | Default                | Description                    |
| ------------------- | ---------------------- | ------------------------------ |
| `TUXEDO_BASE_DIR`   | `$HOME/github`         | Base directory for workspaces  |
| `TUXEDO_EDITOR`     | nvim with local config | Editor command for split panes |
| `TUXEDO_WORKSPACES` | 20                     | Number of workspaces to create |

## Directory Structure

```text
tuxedo/
├── tuxedo.sh          # Main entry point
├── tuxedoKill.sh      # Kill all sessions
├── init-env.sh        # Version manager initialization
├── lib/
│   ├── init-env-lib.sh     # Testable init functions
│   └── tuxedo-kill-lib.sh  # Testable kill functions
├── config/
│   ├── ghostty.conf   # Ghostty terminal config
│   ├── neovim.lua     # Neovim configuration
│   ├── screenrc       # GNU screen config
│   └── tmux.conf      # Tmux configuration
└── tests/
    └── bats/          # Shell tests (run with pnpm test:shell)
```

## Session Management

### Detach (keep running)

```bash
# Keyboard shortcut
Ctrl+B, D

# Or command
tmux detach
```

### Reattach

```bash
./tuxedo.sh  # Reattaches to existing session
```

### Kill everything

```bash
./tuxedoKill.sh
```

## Version Managers

Tuxedo properly initializes version managers so shims come before `/usr/bin` in PATH:

```bash
# In a tuxedo shell:
which ruby    # ~/.rbenv/shims/ruby (not /usr/bin/ruby)
which python  # ~/.pyenv/shims/python
```

Supported managers:

- **rbenv** - Ruby version manager
- **pyenv** - Python version manager
- **nvm** - Node.js version manager

## Testing

```bash
# Run shell tests
pnpm test:shell

# Verbose output
pnpm test:shellVerbose
```

Tests verify:

- Version manager initialization
- PATH order (shims before /usr/bin)
- Kill functions work correctly
