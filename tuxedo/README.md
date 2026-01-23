# Tuxedo

Tuxedo is a tmux-driven workspace orchestrator for the rapid development setup.
It creates a tmux session with windows for each workspace and can optionally
persist each workspace shell via GNU screen.

## Layout

- `tuxedo/tuxedo.sh`: main entrypoint
- `tuxedo/tuxedoKill.sh`: teardown helper
- `tuxedo/config/`: tmux, screen, neovim, and Ghostty config
- `tuxedo/lib/`: reusable shell helpers
- `tuxedo/tests/`: shell tests and coverage scripts

Wrapper scripts remain at `scripts/tuxedo.sh` and `scripts/tuxedoKill.sh` for
backwards compatibility.

## Workspace naming

Tuxedo assumes a `rapid-shared` workspace plus one or more numbered workspaces:

- `rapid-shared`: shared `.secrets`, `.test_files`, and `packages/api/.env` source of truth
- `rapid-main`: first workspace window
- `rapid2...rapidN`: additional workspaces based on `TUXEDO_WORKSPACES`

## Requirements

- `tmux` (required)
- `screen` (optional, enables session persistence)
- `nvim` (optional, used by the default editor command)
- `jq` (optional, used to sync VS Code window titles)
- `ghostty` (optional, used when launched outside a terminal)

## Usage

```sh
# Run tuxedo
./tuxedo/tuxedo.sh

# Or via legacy wrapper
./scripts/tuxedo.sh
```

### Environment variables

- `TUXEDO_BASE_DIR`: base directory for workspaces (default: `$HOME/github`)
- `TUXEDO_EDITOR`: editor command for the right tmux pane
- `TUXEDO_WORKSPACES`: number of workspaces to create (default: 20)
- `TUXEDO_FORCE_SCREEN`: force GNU screen on (`1`)
- `TUXEDO_FORCE_NO_SCREEN`: force GNU screen off (`1`)
- `TUXEDO_SKIP_MAIN`: skip running the main flow (`1`, used by tests)

## Configuration

- `tuxedo/config/tmux.conf`: tmux layout, key bindings, and status bar
- `tuxedo/config/screenrc`: GNU screen settings for persistent panes
- `tuxedo/config/neovim.lua`: default Neovim config for the editor pane
- `tuxedo/config/ghostty.conf`: Ghostty defaults when no TTY is present

## Behavior notes

- Uses `rapid-shared/` as the source of truth for `.secrets`, `.test_files`, and `packages/api/.env`.
- Automatically fast-forwards clean `main` workspaces before setting symlinks.
- When `screen` is available, each workspace runs inside a named screen session
  so long-running processes survive tmux restarts.
- When a session already exists, Tuxedo attaches to it and syncs VS Code titles
  instead of recreating tmux windows.

## Tests

```sh
# Run tuxedo shell tests
./tuxedo/tests/run.sh

# Generate coverage (requires bashcov + bash >= 4)
./tuxedo/tests/coverage.sh

# Or via pnpm script
pnpm test:coverage
```

The coverage run writes a summary baseline to `tuxedo/tests/coverage-baseline.txt`.
