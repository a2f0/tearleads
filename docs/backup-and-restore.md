# Backup and restore

A local backup captures the active identity's SQLite database and the
attachment bytes available on that device. Use it to return to a snapshot or
take local data to another device. Keep your identity recovery phrase
separately. The backup password opens the file. Your recovery phrase restores
the identity you use to sign in.

## Export a backup

1. Unlock the identity you want to back up and open **Backup / Restore**.
2. On the **Backup** tab, enter and confirm a backup password. If you select
   **Back up without a password**, anyone holding the file can read or change
   its contents.
3. Select **Export Backup** and save the `.tlbackup.json` file. Check
   **Missing files** in the summary. A nonzero count means some referenced
   attachments had no local bytes to include.

The exporter reads the database tables, indexes, pending attachment references,
and downloaded attachment references in one transaction. It reads each
distinct referenced storage key once from the local blob store. A file that
exists only on the server contributes no bytes to the backup.
[Snapshot implementation](../packages/app/src/providers/db/localBackupData.ts)

## Inside the file

Both export options produce JSON. A passwordless file contains the payload
directly. A password-protected file contains an encrypted copy of the same
payload. Version 17 uses the following representation.

| Field in the payload | What it contains |
| --- | --- |
| `format`, `version`, `createdAt` | The marker `tearleads.local-backup.payload`, the format version, and the UTC export time. |
| `database.tables`, `database.indexes` | Table and index definitions, column names, and rows. Each row maps column names to JSON strings, numbers, or null. |
| `blobs` | Each available attachment's storage key, original byte length, and bytes encoded as Base64 in `bytesBase64`. Base64 is reversible without a key. |
| `missingBlobStorageKeys`, `summary` | References with missing bytes, plus counts of tables, rows, included and missing files, and included file bytes. |
| `source` | The source database ID, signing fingerprint, and user agent, when available. |

For a password-protected export, the app encodes the password as UTF-8 and
derives a 256-bit key with PBKDF2-HMAC-SHA-256, a fresh 16-byte salt, and
250,000 iterations. It encrypts the UTF-8 JSON payload with AES-256-GCM using
a fresh 12-byte IV. The outer JSON identifies itself as
`tearleads.local-backup.encrypted` and records the version and algorithms.
Its `kdf.salt`, `cipher.iv`, and encrypted `payload` are Base64 strings.
The last string encodes the ciphertext followed by its authentication tag.
The file name includes the export time and, when available, the first 12
characters of the signing fingerprint, even for an encrypted export.
[File encoder and decoder](../packages/app/src/providers/db/localBackupFormat.ts)

## Restore a backup

Restore replaces the active identity's local database. Export a backup first
if you want to keep the current local rows or pending edits. On a new device,
recover the original identity first if you also need its signing keys and
access to synced data.

1. Open **Backup / Restore**, select **Restore**, then **Choose Backup File**.
2. For an encrypted file, enter its backup password and select **Restore
   Backup**. For a trusted passwordless file, select **Restore Unencrypted
   Backup**.
3. When the app reports success, select **Reload App** to reopen the restored
   database and rebuild the local views.

The app checks the format and version, authenticates encrypted files, and
validates the payload and schema before writing attachments. A wrong password
or damaged ciphertext stops the restore before it changes local data.
The app also checks security records against evidence already on the device.
For example, restoring an older snapshot preserves a known document purge,
and conflicting purge checkpoints can stop the restore.

The app writes the included attachment bytes, then rebuilds and migrates the
database inside a SQLite transaction. If that transaction fails, SQLite rolls
it back and the app attempts to undo each attachment write. Only the bytes
included in the file can be recovered from it.
[Database restore](../packages/app/src/providers/db/localBackupDatabase.ts)
and [purge checkpoint rules](../formal/backup-restore/TerminalAnchors.md).
