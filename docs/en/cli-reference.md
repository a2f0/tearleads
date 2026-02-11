# CLI Reference

This reference documents the current `tearleads` CLI behavior from `packages/cli`.

## Command Summary

- `tearleads setup` Initialize a new encrypted database.
- `tearleads unlock` Unlock the database (restores session when available).
- `tearleads lock` Lock the database.
- `tearleads backup <file>` Export an encrypted `.rbu` backup file.
- `tearleads restore <file>` Import an encrypted `.rbu` backup file.
- `tearleads dump <folder>` Export unencrypted JSON files.
- `tearleads password` Change the database password.
- `tearleads list-instances` Show instance and session status.

## Global Usage

```bash
tearleads --help
tearleads --version
```

## Commands

### `setup`

Initialize a new encrypted database.

```bash
tearleads setup
```

Prompts:

- `Enter password:`
- `Confirm password:`

### `unlock`

Unlock the database. If a persisted session exists, the CLI attempts session restore first.

```bash
tearleads unlock
```

Prompt:

- `Enter password:`

### `lock`

Lock the database and clear in-memory key state.

```bash
tearleads lock
```

### `backup <file>`

Export current database state to an encrypted `.rbu` backup file.

```bash
tearleads backup ./backup.rbu
tearleads backup ./backup.rbu --password "backup-pass"
```

Options:

- `-p, --password <password>` Provide backup password non-interactively.

If `--password` is omitted, prompts:

- `Backup password:`
- `Confirm backup password:`

### `restore <file>`

Restore database contents from an encrypted `.rbu` backup.

```bash
tearleads restore ./backup.rbu
tearleads restore ./backup.rbu --force
tearleads restore ./backup.rbu --password "backup-pass"
```

Options:

- `-f, --force` Skip overwrite confirmation.
- `-p, --password <password>` Provide backup password non-interactively.

Prompts when `--force` is not set:

- `This will overwrite existing data. Continue? (y/n):`

Prompt when `--password` is omitted:

- `Backup password:`

### `dump <folder>`

Dump schema and data to unencrypted JSON files.

```bash
tearleads dump ./dump-output
tearleads dump ./dump-output --force
tearleads dump ./dump-output --no-blobs
tearleads dump ./dump-output --input-file ./backup.rbu --password "backup-pass"
```

Options:

- `-f, --input-file <file>` Read from `.rbu` backup instead of live DB.
- `-p, --password <password>` Backup password for `--input-file`.
- `--force` Overwrite existing output folder without prompt.
- `--no-blobs` Skip creating the `files/` directory.

Note:

- In `dump`, `-f` maps to `--input-file` (not `--force`), matching current `packages/cli` behavior.

Output structure:

- `manifest.json`
- `schema.json`
- `tables/*.json`
- `files/` (unless `--no-blobs`)

### `password`

Change the encryption password for the local database.

```bash
tearleads password
```

Prompts:

- `Current password:`
- `New password:`
- `Confirm new password:`

### `list-instances`

Display basic instance/session state.

```bash
tearleads list-instances
```

Current output includes a single default instance with:

- setup status
- unlocked status
- persisted-session status
