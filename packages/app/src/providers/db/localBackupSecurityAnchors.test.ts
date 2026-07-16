import { expect, test } from "bun:test";
import {
  type BlobByteSource,
  type BlobBytes,
  type BlobStore,
  createBlobByteSource,
  readBlobByteSource,
} from "@tearleads/client-sdk";
import type { ExecSql } from "@tearleads/client-sdk/sqlite";
import { createTestExecSql } from "@tearleads/test-utils";
import { createBackupPayload, restoreBackupPayload } from "./localBackupData";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const UPDATED_AT = "2026-07-15T12:00:00.000Z";

class RecordingBlobStore implements BlobStore {
  readonly bytesByKey = new Map<string, BlobBytes>();
  readonly writeKeys: string[] = [];

  async deleteBytes(storageKey: string): Promise<void> {
    this.bytesByKey.delete(storageKey);
  }

  async readBytes(storageKey: string): Promise<BlobBytes | null> {
    return this.bytesByKey.get(storageKey) ?? null;
  }

  async openByteSource(storageKey: string): Promise<BlobByteSource | null> {
    const bytes = this.bytesByKey.get(storageKey);
    return bytes ? createBlobByteSource(bytes.slice() as BlobBytes) : null;
  }

  async writeByteSource(
    storageKey: string,
    source: BlobByteSource,
  ): Promise<void> {
    await this.writeBytes(storageKey, await readBlobByteSource(source));
  }

  async writeBytes(storageKey: string, bytes: BlobBytes): Promise<void> {
    this.writeKeys.push(storageKey);
    this.bytesByKey.set(storageKey, bytes.slice() as BlobBytes);
  }
}

class PausingBlobStore extends RecordingBlobStore {
  readonly writeStarted = Promise.withResolvers<void>();
  private readonly resumeWrite = Promise.withResolvers<void>();
  private paused = false;

  releaseWrite(): void {
    this.resumeWrite.resolve();
  }

  override async writeBytes(
    storageKey: string,
    bytes: BlobBytes,
  ): Promise<void> {
    await super.writeBytes(storageKey, bytes);
    if (!this.paused) {
      this.paused = true;
      this.writeStarted.resolve();
      await this.resumeWrite.promise;
    }
  }
}

async function createCheckpointTables(execSql: ExecSql): Promise<void> {
  await execSql(`
    CREATE TABLE access_manifest_checkpoints (
      object_kind TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      object_id TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      manifest_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (object_kind, organization_id, object_id)
    )
  `);
  await execSql(`
    CREATE TABLE principal_policy_checkpoints (
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      state_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (principal_type, principal_id)
    )
  `);
}

async function insertAccessCheckpoint(
  execSql: ExecSql,
  input: {
    readonly epoch: number;
    readonly hash: string;
    readonly objectId: string;
  },
): Promise<void> {
  await execSql(
    `INSERT INTO access_manifest_checkpoints (
       object_kind, organization_id, object_id, epoch, manifest_hash, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      "document",
      "organization-1",
      input.objectId,
      input.epoch,
      input.hash,
      UPDATED_AT,
    ],
  );
}

async function insertPrincipalCheckpoint(
  execSql: ExecSql,
  input: {
    readonly hash: string;
    readonly principalId: string;
    readonly version: number;
  },
): Promise<void> {
  await execSql(
    `INSERT INTO principal_policy_checkpoints (
       principal_type, principal_id, version, state_hash, updated_at
     ) VALUES (?, ?, ?, ?, ?)`,
    ["group", input.principalId, input.version, input.hash, UPDATED_AT],
  );
}

async function createPayload(
  execSql: ExecSql,
  blobStore = new RecordingBlobStore(),
) {
  return createBackupPayload({
    blobStore,
    databaseId: "backup-source",
    execSql,
    signingFingerprint: null,
  });
}

test("restore preserves current checkpoints when a current backup has no anchor tables", async () => {
  const source = await createTestExecSql("backup-no-anchors-source");
  const target = await createTestExecSql("backup-no-anchors-target");
  try {
    await source.execSql(
      "CREATE TABLE restored_records (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    await source.execSql(
      "INSERT INTO restored_records (id, value) VALUES (?, ?)",
      ["restored-1", "restored"],
    );
    const payload = await createPayload(source.execSql);

    await createCheckpointTables(target.execSql);
    await insertAccessCheckpoint(target.execSql, {
      epoch: 5,
      hash: HASH_A,
      objectId: "document-current",
    });
    await insertPrincipalCheckpoint(target.execSql, {
      hash: HASH_B,
      principalId: "group-current",
      version: 4,
    });

    await restoreBackupPayload({
      blobStore: new RecordingBlobStore(),
      execSql: target.execSql,
      payload,
    });

    await expect(
      target.execSql(
        "SELECT epoch, manifest_hash FROM access_manifest_checkpoints",
      ),
    ).resolves.toEqual([{ epoch: 5, manifest_hash: HASH_A }]);
    await expect(
      target.execSql(
        "SELECT version, state_hash FROM principal_policy_checkpoints",
      ),
    ).resolves.toEqual([{ state_hash: HASH_B, version: 4 }]);
    await expect(
      target.execSql("SELECT id, value FROM restored_records"),
    ).resolves.toEqual([{ id: "restored-1", value: "restored" }]);
  } finally {
    source.close();
    target.close();
  }
});

test("restore keeps the strongest checkpoint and imports backup-only scopes", async () => {
  const source = await createTestExecSql("backup-checkpoint-max-source");
  const target = await createTestExecSql("backup-checkpoint-max-target");
  try {
    await createCheckpointTables(source.execSql);
    await insertAccessCheckpoint(source.execSql, {
      epoch: 2,
      hash: HASH_B,
      objectId: "document-overlap",
    });
    await insertAccessCheckpoint(source.execSql, {
      epoch: 1,
      hash: HASH_C,
      objectId: "document-backup-only",
    });
    await insertPrincipalCheckpoint(source.execSql, {
      hash: HASH_D,
      principalId: "group-overlap",
      version: 4,
    });
    const payload = await createPayload(source.execSql);

    await createCheckpointTables(target.execSql);
    await insertAccessCheckpoint(target.execSql, {
      epoch: 3,
      hash: HASH_A,
      objectId: "document-overlap",
    });
    await insertPrincipalCheckpoint(target.execSql, {
      hash: HASH_C,
      principalId: "group-overlap",
      version: 2,
    });

    await restoreBackupPayload({
      blobStore: new RecordingBlobStore(),
      execSql: target.execSql,
      payload,
    });

    await expect(
      target.execSql(
        `SELECT object_id, epoch, manifest_hash
         FROM access_manifest_checkpoints
         ORDER BY object_id`,
      ),
    ).resolves.toEqual([
      {
        epoch: 1,
        manifest_hash: HASH_C,
        object_id: "document-backup-only",
      },
      {
        epoch: 3,
        manifest_hash: HASH_A,
        object_id: "document-overlap",
      },
    ]);
    await expect(
      target.execSql(
        "SELECT principal_id, version, state_hash FROM principal_policy_checkpoints",
      ),
    ).resolves.toEqual([
      { principal_id: "group-overlap", state_hash: HASH_D, version: 4 },
    ]);
  } finally {
    source.close();
    target.close();
  }
});

test("restore imports checkpoint tables into a target where they are still lazy", async () => {
  const source = await createTestExecSql("backup-anchor-import-source");
  const target = await createTestExecSql("backup-anchor-import-target");
  try {
    await createCheckpointTables(source.execSql);
    await insertAccessCheckpoint(source.execSql, {
      epoch: 1,
      hash: HASH_A,
      objectId: "document-backup-only",
    });
    await insertPrincipalCheckpoint(source.execSql, {
      hash: HASH_B,
      principalId: "group-backup-only",
      version: 1,
    });

    await restoreBackupPayload({
      blobStore: new RecordingBlobStore(),
      execSql: target.execSql,
      payload: await createPayload(source.execSql),
    });

    await expect(
      target.execSql("SELECT epoch FROM access_manifest_checkpoints"),
    ).resolves.toEqual([{ epoch: 1 }]);
    await expect(
      target.execSql("SELECT version FROM principal_policy_checkpoints"),
    ).resolves.toEqual([{ version: 1 }]);
  } finally {
    source.close();
    target.close();
  }
});

test("checkpoint conflict is preflighted before blob writes or table replacement", async () => {
  const source = await createTestExecSql("backup-anchor-conflict-source");
  const target = await createTestExecSql("backup-anchor-conflict-target");
  const sourceBlobs = new RecordingBlobStore();
  const targetBlobs = new RecordingBlobStore();
  try {
    await createCheckpointTables(source.execSql);
    await insertAccessCheckpoint(source.execSql, {
      epoch: 3,
      hash: HASH_B,
      objectId: "document-conflict",
    });
    await source.execSql(`
      CREATE TABLE document_attachment_blob_projection (
        local_id TEXT NOT NULL,
        slot_id TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        PRIMARY KEY (local_id, slot_id)
      )
    `);
    await source.execSql(
      `INSERT INTO document_attachment_blob_projection
         (local_id, slot_id, storage_key) VALUES (?, ?, ?)`,
      ["document-conflict", "slot-1", "must-not-write"],
    );
    sourceBlobs.bytesByKey.set(
      "must-not-write",
      new TextEncoder().encode("unsafe") as BlobBytes,
    );
    const payload = await createPayload(source.execSql, sourceBlobs);

    await createCheckpointTables(target.execSql);
    await insertAccessCheckpoint(target.execSql, {
      epoch: 3,
      hash: HASH_A,
      objectId: "document-conflict",
    });
    await target.execSql(
      "CREATE TABLE local_only_records (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    await target.execSql(
      "INSERT INTO local_only_records (id, value) VALUES (?, ?)",
      ["local-1", "must survive"],
    );

    await expect(
      restoreBackupPayload({
        blobStore: targetBlobs,
        execSql: target.execSql,
        payload,
      }),
    ).rejects.toThrow("Backup conflicts with an access manifest checkpoint");
    expect(targetBlobs.writeKeys).toEqual([]);
    await expect(
      target.execSql("SELECT id, value FROM local_only_records"),
    ).resolves.toEqual([{ id: "local-1", value: "must survive" }]);
  } finally {
    source.close();
    target.close();
  }
});

test("checkpoint conflict during blob restore rolls overwritten bytes back", async () => {
  const source = await createTestExecSql("backup-anchor-race-source");
  const target = await createTestExecSql("backup-anchor-race-target");
  const sourceBlobs = new RecordingBlobStore();
  const targetBlobs = new PausingBlobStore();
  const originalBytes = new TextEncoder().encode("original") as BlobBytes;
  try {
    await createCheckpointTables(source.execSql);
    await insertAccessCheckpoint(source.execSql, {
      epoch: 3,
      hash: HASH_B,
      objectId: "document-race",
    });
    await source.execSql(`
      CREATE TABLE document_attachment_blob_projection (
        local_id TEXT NOT NULL,
        slot_id TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        PRIMARY KEY (local_id, slot_id)
      )
    `);
    await source.execSql(
      `INSERT INTO document_attachment_blob_projection
         (local_id, slot_id, storage_key) VALUES (?, ?, ?)`,
      ["document-race", "slot-1", "shared-key"],
    );
    sourceBlobs.bytesByKey.set(
      "shared-key",
      new TextEncoder().encode("restored") as BlobBytes,
    );
    const payload = await createPayload(source.execSql, sourceBlobs);

    await createCheckpointTables(target.execSql);
    await insertAccessCheckpoint(target.execSql, {
      epoch: 2,
      hash: HASH_A,
      objectId: "document-race",
    });
    targetBlobs.bytesByKey.set("shared-key", originalBytes);

    const restore = restoreBackupPayload({
      blobStore: targetBlobs,
      execSql: target.execSql,
      payload,
    });
    await targetBlobs.writeStarted.promise;
    await target.execSql(
      `UPDATE access_manifest_checkpoints
       SET epoch = ?, manifest_hash = ?, updated_at = ?
       WHERE object_kind = ? AND organization_id = ? AND object_id = ?`,
      [3, HASH_C, UPDATED_AT, "document", "organization-1", "document-race"],
    );
    targetBlobs.releaseWrite();

    await expect(restore).rejects.toThrow(
      "Backup conflicts with an access manifest checkpoint",
    );
    expect(
      new TextDecoder().decode(targetBlobs.bytesByKey.get("shared-key")),
    ).toBe("original");
    await expect(
      target.execSql(
        "SELECT epoch, manifest_hash FROM access_manifest_checkpoints",
      ),
    ).resolves.toEqual([{ epoch: 3, manifest_hash: HASH_C }]);
  } finally {
    targetBlobs.releaseWrite();
    source.close();
    target.close();
  }
});
