# Console Reference

This reference documents the commands available in the Console window.

## Command Summary

- `setup` Initialize a new encrypted database.
- `unlock` Unlock the database (restores session when available).
- `lock` Lock the database.
- `backup <file>` Export an encrypted `.tbu` backup file.
- `restore <file>` Import an encrypted `.tbu` backup file.
- `dump <folder>` Export unencrypted JSON files.
- `password` Change the database password.
- `list-instances` Show instance and session status.

## Global Usage

```bash
--help
--version
```

## Commands

### `setup`

Initialize a new encrypted database.

```bash
setup
```

Prompts:

- `Enter password:`
- `Confirm password:`

### `unlock`

Unlock the database. If a persisted session exists, the CLI attempts session restore first.

```bash
unlock
```

Prompt:

- `Enter password:`

### `lock`

Lock the database and clear in-memory key state.

```bash
lock
```

### `backup <file>`

Export current database state to an encrypted `.tbu` backup file.

```bash
backup ./backup.tbu
backup ./backup.tbu --password "backup-pass"
```

Options:

- `-p, --password <password>` Provide backup password non-interactively.

If `--password` is omitted, prompts:

- `Backup password:`
- `Confirm backup password:`

### `restore <file>`

Restore database contents from an encrypted `.tbu` backup.

```bash
restore ./backup.tbu
restore ./backup.tbu --force
restore ./backup.tbu --password "backup-pass"
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
dump ./dump-output
dump ./dump-output --force
dump ./dump-output --no-blobs
dump ./dump-output --input-file ./backup.tbu --password "backup-pass"
```

Options:

- `-f, --input-file <file>` Read from `.tbu` backup instead of live DB.
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
password
```

Prompts:

- `Current password:`
- `New password:`
- `Confirm new password:`

### `list-instances`

Display basic instance/session state.

```bash
list-instances
```

Current output includes a single default instance with:

- setup status
- unlocked status
- persisted-session status
