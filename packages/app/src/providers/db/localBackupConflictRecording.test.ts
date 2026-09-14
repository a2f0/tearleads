import { expect, test } from "bun:test";
import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { BackupRestoreConflictError } from "./backupRestoreConflict";
import { createBackupPayload, restoreBackupPayload } from "./localBackupData";
import { DocumentPurgeCheckpointConflictError } from "./terminalSecurityAnchorBackupMerge";

const UPDATED_AT = "2026-09-12T12:00:00.000Z";
const HASH = "a".repeat(64);
const schema = [
  `CREATE TABLE document_purge_checkpoints (
    document_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
    document_manifest_hash TEXT NOT NULL, purge_event_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE security_incidents (
    id TEXT PRIMARY KEY, trust_domain TEXT, code TEXT NOT NULL,
    operation TEXT NOT NULL, object_kind TEXT NOT NULL, object_id TEXT,
    organization_id TEXT, evidence_hashes TEXT NOT NULL,
    detected_at TEXT NOT NULL, last_detected_at TEXT NOT NULL,
    occurrence_count INTEGER NOT NULL DEFAULT 1
  )`,
];

test("a purge proof conflict is recorded in the live incident ledger and surfaces typed", async () => {
  const target = createNativeTestExecSql();
  const source = createNativeTestExecSql();
  const sdk = new Tearleads({
    apiBaseUrl: "https://api.example.test",
    database: { execSql: target.execSql },
    logger: { log() {}, logError() {} },
  });
  try {
    for (const db of [source, target]) {
      for (const sql of schema) await db.execSql(sql);
    }
    await target.execSql(
      "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?, ?)",
      ["document-1", "organization-1", HASH, HASH, UPDATED_AT],
    );
    await source.execSql(
      "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?, ?)",
      ["document-1", "organization-1", HASH, "b".repeat(64), UPDATED_AT],
    );
    const payload = await createBackupPayload({
      blobStore: createMemoryBlobStore(),
      databaseId: "backup-source",
      execSql: source.execSql,
      signingFingerprint: null,
    });
    const restore = restoreBackupPayload({
      blobStore: createMemoryBlobStore(),
      execSql: target.execSql,
      payload,
      securityIncidents: sdk.securityIncidents,
    });
    await expect(restore).rejects.toBeInstanceOf(BackupRestoreConflictError);
    const refusal = await restore.catch((error: unknown) => error);
    if (!(refusal instanceof BackupRestoreConflictError)) throw refusal;
    expect(refusal.conflict).toBeInstanceOf(
      DocumentPurgeCheckpointConflictError,
    );
    expect(refusal.recording).toBe("recorded");
    expect(
      await target.execSql(
        "SELECT purge_event_hash FROM document_purge_checkpoints",
      ),
    ).toEqual([{ purge_event_hash: HASH }]);
    expect(await sdk.securityIncidents.list()).toEqual([
      expect.objectContaining({
        code: "object_mismatch",
        evidenceHashes: {
          current_document_manifest_hash: HASH,
          current_purge_event_hash: HASH,
          restored_document_manifest_hash: HASH,
          restored_purge_event_hash: "b".repeat(64),
        },
        objectId: "document-1",
        objectKind: "document",
        occurrenceCount: 1,
        operation: "backup.restore",
        organizationId: "organization-1",
      }),
    ]);
  } finally {
    sdk.dispose();
    source.close();
    target.close();
  }
});

test("a purge proof conflict the ledger could not keep surfaces its recording status", async () => {
  const target = createNativeTestExecSql();
  const source = createNativeTestExecSql();
  try {
    for (const db of [source, target]) {
      for (const sql of schema) await db.execSql(sql);
    }
    await target.execSql(
      "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?, ?)",
      ["document-1", "organization-1", HASH, HASH, UPDATED_AT],
    );
    await source.execSql(
      "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?, ?)",
      ["document-1", "organization-1", HASH, "b".repeat(64), UPDATED_AT],
    );
    const payload = await createBackupPayload({
      blobStore: createMemoryBlobStore(),
      databaseId: "backup-source",
      execSql: source.execSql,
      signingFingerprint: null,
    });
    const recorded: unknown[] = [];
    const refusal = await restoreBackupPayload({
      blobStore: createMemoryBlobStore(),
      execSql: target.execSql,
      payload,
      securityIncidents: {
        async record(error) {
          recorded.push(error);
          return "failed";
        },
      },
    }).catch((error: unknown) => error);
    if (!(refusal instanceof BackupRestoreConflictError)) throw refusal;
    expect(recorded).toEqual([refusal.conflict]);
    expect(refusal.recording).toBe("failed");
    expect(refusal.ledgerFailures).toEqual([]);
    expect(refusal.rollbackFailures).toEqual([]);
    expect(
      await target.execSql(
        "SELECT purge_event_hash FROM document_purge_checkpoints",
      ),
    ).toEqual([{ purge_event_hash: HASH }]);
  } finally {
    source.close();
    target.close();
  }
});

test("a purge pin conflict keeps the blob rollback failures it was raised with", async () => {
  const target = createNativeTestExecSql();
  const source = createNativeTestExecSql();
  const rollbackFailure = new Error("blob store offline");
  const blobStore = createMemoryBlobStore();
  try {
    for (const db of [source, target]) {
      for (const sql of schema) await db.execSql(sql);
    }
    await source.execSql(
      "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?, ?)",
      ["document-1", "organization-1", HASH, "b".repeat(64), UPDATED_AT],
    );
    const payload = await createBackupPayload({
      blobStore: createMemoryBlobStore(),
      databaseId: "backup-source",
      execSql: source.execSql,
      signingFingerprint: null,
    });
    const refusal = await restoreBackupPayload({
      blobStore: {
        deleteBytes: async () => {
          throw rollbackFailure;
        },
        openByteSource: (key) => blobStore.openByteSource(key),
        readBytes: (key) => blobStore.readBytes(key),
        writeByteSource: (key, bytes) => blobStore.writeByteSource(key, bytes),
        // The conflicting pin lands after preflight, while the backup's
        // attachment bytes are being written ahead of the database.
        writeBytes: async (key, bytes) => {
          await target.execSql(
            "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?, ?)",
            ["document-1", "organization-1", HASH, HASH, UPDATED_AT],
          );
          await blobStore.writeBytes(key, bytes);
        },
      },
      execSql: target.execSql,
      payload: {
        ...payload,
        blobs: [{ byteLength: 1, bytesBase64: "AA==", storageKey: "blob-1" }],
      },
      securityIncidents: {
        async record() {
          return "recorded";
        },
      },
    }).catch((error: unknown) => error);
    if (!(refusal instanceof BackupRestoreConflictError)) throw refusal;
    expect(refusal.conflict).toBeInstanceOf(
      DocumentPurgeCheckpointConflictError,
    );
    expect(refusal.recording).toBe("recorded");
    expect(refusal.ledgerFailures).toEqual([]);
    expect(refusal.rollbackFailures).toEqual([rollbackFailure]);
    expect(refusal.cause).toBeInstanceOf(AggregateError);
    expect(await blobStore.readBytes("blob-1")).toEqual(new Uint8Array([0]));
    expect(
      await target.execSql(
        "SELECT purge_event_hash FROM document_purge_checkpoints",
      ),
    ).toEqual([{ purge_event_hash: HASH }]);
  } finally {
    source.close();
    target.close();
  }
});

test("a rejecting incident ledger does not hide the conflict or its rollback failures", async () => {
  const target = createNativeTestExecSql();
  const source = createNativeTestExecSql();
  const rollbackFailure = new Error("blob store offline");
  const ledgerFailure = new Error("incident ledger unavailable");
  const blobStore = createMemoryBlobStore();
  try {
    for (const db of [source, target]) {
      for (const sql of schema) await db.execSql(sql);
    }
    await source.execSql(
      "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?, ?)",
      ["document-1", "organization-1", HASH, "b".repeat(64), UPDATED_AT],
    );
    const payload = await createBackupPayload({
      blobStore: createMemoryBlobStore(),
      databaseId: "backup-source",
      execSql: source.execSql,
      signingFingerprint: null,
    });
    const refusal = await restoreBackupPayload({
      blobStore: {
        deleteBytes: async () => {
          throw rollbackFailure;
        },
        openByteSource: (key) => blobStore.openByteSource(key),
        readBytes: (key) => blobStore.readBytes(key),
        writeByteSource: (key, bytes) => blobStore.writeByteSource(key, bytes),
        // The conflicting pin lands after preflight, while the backup's
        // attachment bytes are being written ahead of the database.
        writeBytes: async (key, bytes) => {
          await target.execSql(
            "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?, ?)",
            ["document-1", "organization-1", HASH, HASH, UPDATED_AT],
          );
          await blobStore.writeBytes(key, bytes);
        },
      },
      execSql: target.execSql,
      payload: {
        ...payload,
        blobs: [{ byteLength: 1, bytesBase64: "AA==", storageKey: "blob-1" }],
      },
      securityIncidents: {
        async record() {
          throw ledgerFailure;
        },
      },
    }).catch((error: unknown) => error);
    if (!(refusal instanceof BackupRestoreConflictError)) throw refusal;
    expect(refusal.conflict).toBeInstanceOf(
      DocumentPurgeCheckpointConflictError,
    );
    expect(refusal.recording).toBe("failed");
    expect(refusal.ledgerFailures).toEqual([ledgerFailure]);
    expect(refusal.rollbackFailures).toEqual([rollbackFailure]);
    expect(refusal.cause).toBeInstanceOf(AggregateError);
    expect(await blobStore.readBytes("blob-1")).toEqual(new Uint8Array([0]));
    expect(
      await target.execSql(
        "SELECT purge_event_hash FROM document_purge_checkpoints",
      ),
    ).toEqual([{ purge_event_hash: HASH }]);
  } finally {
    source.close();
    target.close();
  }
});
