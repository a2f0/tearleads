# Backup and Restore

Tearleads provides a universal backup format (.tbu) that works across all platforms. Backups include your database schema, data, and files, all protected with strong encryption.

## TBU File Format Specification

The **Tearleads Backup Utility** (.tbu) format is a cross-platform backup format designed for secure, portable backups.

### File Structure

```text
┌─────────────────────────────────────────┐
│              HEADER (36 bytes)          │
├─────────────────────────────────────────┤
│   Magic Bytes: "TEARLEADSBAK" (12 bytes)    │
│    Format Version (2 bytes, LE)         │
│    Flags (2 bytes, LE)                  │
│    Salt (16 bytes)                      │
│    Reserved (4 bytes)                   │
├─────────────────────────────────────────┤
│           ENCRYPTED CHUNKS              │
├─────────────────────────────────────────┤
│    Chunk 0: Manifest                    │
│    Chunk 1: Database                    │
│    Chunk 2..N: Blobs (files)            │
└─────────────────────────────────────────┘
```

### Header Format (36 bytes, plaintext)

| Offset | Size | Field | Description |
| ------ | ---- | ----- | ----------- |
| 0 | 12 | Magic | `TEARLEADSBAK` (0x54 0x45 0x41 0x52 0x4c 0x45 0x41 0x44 0x53 0x42 0x41 0x4b) |
| 12 | 2 | Version | Format version (currently 1), little-endian |
| 14 | 2 | Flags | Reserved for future use |
| 16 | 16 | Salt | Random salt for PBKDF2 key derivation |
| 32 | 4 | Reserved | Reserved for future expansion |

### Encryption

Backups use strong encryption to protect your data:

1. **Key Derivation**: PBKDF2-SHA256 with 600,000 iterations
2. **Encryption**: AES-256-GCM (authenticated encryption)
3. **Compression**: Gzip before encryption

Each encrypted chunk has a 20-byte header followed by ciphertext:

| Size | Field | Description |
| ---- | ----- | ----------- |
| 4 | Payload Length | Size of the following ciphertext in bytes |
| 1 | Chunk Type | 0=Manifest, 1=Database, 2=Blob |
| 3 | Reserved | Reserved for future use |
| 12 | IV | Initialization vector for AES-GCM |
| N | Ciphertext | Encrypted and compressed data, including the 16-byte GCM authentication tag |

### Chunk Types

#### Manifest Chunk (Type 0)

Contains metadata about the backup:

```json
{
  "createdAt": "2024-01-15T10:30:00Z",
  "platform": "web",
  "appVersion": "1.2.3",
  "formatVersion": 1,
  "blobCount": 42,
  "blobTotalSize": 1048576,
  "instanceName": "My Instance"
}
```

#### Database Chunk (Type 1)

Contains schema and data:

```json
{
  "tables": [
    { "name": "contacts", "sql": "CREATE TABLE contacts (...)" }
  ],
  "indexes": [
    { "name": "idx_contacts_email", "sql": "CREATE INDEX ..." }
  ],
  "data": {
    "contacts": [
      { "id": 1, "name": "John", "email": "john@example.com" }
    ]
  }
}
```

#### Blob Chunks (Type 2)

Contains file data. Large files (>10 MB) are split across multiple chunks:

```json
{
  "path": "files/abc123.jpg",
  "mimeType": "image/jpeg",
  "size": 2048576,
  "partIndex": 0,
  "totalParts": 1
}
```

### Security Properties

- **Password-protected**: Backup requires a password to create and restore
- **Authenticated**: GCM authentication prevents tampering
- **No key material**: Encryption keys are never stored in the backup
- **Salted**: Each backup uses a unique random salt

## Creating a Backup

### From the Application

1. Open **Settings** and navigate to **Backups**
2. In the "Create Backup" section:
   - Enter a **backup password** (this protects the backup file)
   - Confirm the password
   - Optionally check **Include files** to backup photos, documents, etc.
3. Click **Create Backup**
4. Wait for the backup to complete (progress bar shows status)
5. The backup is saved:
   - **Modern browsers**: Stored in browser storage (OPFS) and listed in "Stored Backups"
   - **Other browsers**: Downloaded to your Downloads folder

The backup file is named `tearleads-backup-YYYY-MM-DD-HHmmss.tbu`.

### From the CLI

```bash
# Interactive (prompts for password)
tearleads backup /path/to/backup.tbu

# Non-interactive
tearleads backup /path/to/backup.tbu --password "your-backup-password"
```

Note: CLI backups include database data but not files (blobs).

## Restoring a Backup

### From a Stored Backup

If your browser supports OPFS, backups are stored locally and listed in the "Stored Backups" section:

1. Open **Settings** and navigate to **Backups**
2. Find your backup in the "Stored Backups" table
3. Click **Restore** next to the backup
4. Enter the **backup password** (the password used when creating the backup)
5. Click **Validate Backup** to verify the password
6. Once validated, you'll see backup details (creation date, platform, file count)
7. Enter a **new instance password** (this will be the password for the restored instance)
8. Confirm the new password
9. Click **Restore Backup**
10. Wait for restoration to complete
11. Switch to the new instance from the instance selector

### From an External File

1. Open **Settings** and navigate to **Backups**
2. In the "Restore from File" section, click **Select Backup File (.tbu)**
3. Choose a `.tbu` file from your computer
4. Follow the same validation and restore steps as above

### Restore from the CLI

```bash
# Interactive (prompts for password and confirmation)
tearleads restore /path/to/backup.tbu

# Non-interactive
tearleads restore /path/to/backup.tbu --password "backup-password" --force
```

Warning: CLI restore replaces the current database. Use `--force` to skip confirmation.

## Platform Comparison

| Feature | Web (WASM) | Electron | iOS/Android | CLI |
| ------- | ---------- | -------- | ----------- | --- |
| Create Backup | Yes | Yes | Yes | Yes |
| Restore Backup | Yes | Yes | Yes | Yes |
| Include Files | Yes | Yes | Yes | No |
| Backup Storage | OPFS/Download | File system | File system | File system |
| Cross-Platform Restore | Yes | Yes | Yes | Yes |

## Backup Contents

### Included

- All database tables and indexes
- All table data (contacts, notes, etc.)
- Files (photos, documents, attachments) if "Include files" is checked
- Database schema for recreation

### Excluded

- SQLite internal tables (`sqlite_sequence`, `sqlite_stat1`, etc.)
- Migration history (`__drizzle_migrations`)
- Internal tables (tables starting with `_`)
- Encryption keys (derived from your password)

## Best Practices

1. **Use a strong backup password** - This protects your backup file if someone gains access to it
2. **Store backups securely** - Keep backup files in a safe location
3. **Test restores periodically** - Verify your backups work by restoring to a test instance
4. **Back up regularly** - Create backups before major changes or periodically
5. **Remember your passwords** - You need the backup password to restore; there's no recovery option
6. **Include files when needed** - File backups are larger but include all your attachments

## Troubleshooting

### "Invalid password" error

The password entered doesn't match the password used to create the backup. Try again with the correct password.

### "Invalid backup file" error

The file may be corrupted or not a valid .tbu file. Check that:

- The file has the `.tbu` extension
- The file wasn't modified or truncated
- The file was fully downloaded/transferred

### Large backup files

If your backup is very large:

- Consider excluding files for a smaller backup
- Ensure you have enough storage space
- Be patient during backup/restore (progress is shown)

### Restore creates a new instance

This is by design. Restoring from the application UI creates a new instance named "Backup (Month Day, Year)" to prevent overwriting your current data. You can switch between instances from the instance selector. In contrast, restoring from the CLI overwrites the current database.
