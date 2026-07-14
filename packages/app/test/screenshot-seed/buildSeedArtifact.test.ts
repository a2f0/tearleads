import { expect, test } from "bun:test";
import {
  createMemoryBlobStore,
  type Logger,
  Tearleads,
} from "@tearleads/client-sdk";
import type { ExecSql } from "@tearleads/client-sdk/sqlite";
import { createTestExecSql } from "@tearleads/test-utils";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../src/document-types/projectors";
import { restoreBackupPayload } from "../../src/providers/db/localBackupData";
import { decodeBackupFile } from "../../src/providers/db/localBackupFormat";
import { buildSeedArtifact } from "./buildSeedArtifact";
import type { SeedSpec } from "./seedTypes";

// End-to-end proof that the seeder produces an artifact whose restore reproduces
// exactly what the mini-apps read: documents summaries (Notes/Explorer), the
// contact_projection read model (Contacts), and attachment blob bytes.

const quietLogger: Required<Logger> = {
  log: () => undefined,
  logError: () => undefined,
};

const PASSWORD = "screenshot-seed-test";

// A valid 1x1 transparent PNG so attachments carry real, decodable bytes.
const PNG_1X1 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

const SPEC: SeedSpec = {
  contacts: [{ fields: { firstName: "Ada", lastName: "Lovelace" } }],
  files: [
    {
      attachments: [
        { file: "front.png", mimeType: "image/png", slot: "front" },
        { file: "back.png", mimeType: "image/png", slot: "back" },
      ],
      fields: { expirationDate: "2030-01-01", licenseId: "D1234567" },
      kind: "drivers_license",
    },
    {
      attachments: [{ file: "logo.png", mimeType: "image/png" }],
      fields: { fileName: "logo.png", mimeType: "image/png" },
      kind: "image",
    },
  ],
  notes: [{ text: "Launch checklist\n- Draft copy\n- Ship screenshots" }],
  password: PASSWORD,
};

function bytesEqual(a: Uint8Array | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) {
    return false;
  }
  for (let i = 0; i < b.byteLength; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

async function countRows(execSql: ExecSql, table: string): Promise<number> {
  const rows = (await execSql(`SELECT COUNT(*) AS n FROM ${table}`)) as Array<{
    n: number;
  }>;
  return Number(rows[0]?.n ?? 0);
}

test("buildSeedArtifact produces a restorable backup with contacts, notes, and attachments", async () => {
  const source = await createTestExecSql("seed-artifact-source-key");
  const target = await createTestExecSql("seed-artifact-target-key");
  const sourceExecSql = source.execSql as ExecSql;
  const targetExecSql = target.execSql as ExecSql;
  const sourceBlobStore = createMemoryBlobStore();
  const targetBlobStore = createMemoryBlobStore();

  try {
    const artifact = await buildSeedArtifact(SPEC, {
      blobStore: sourceBlobStore,
      execSql: sourceExecSql,
      readAttachment: async () => PNG_1X1,
    });

    // 3 attachments (license front + back, one image).
    expect(artifact.summary.blobCount).toBe(3);
    expect(artifact.summary.rowCount).toBeGreaterThan(0);
    expect(await countRows(sourceExecSql, "contact_projection")).toBe(1);

    const attachmentRows = (await sourceExecSql(
      "SELECT storage_key FROM document_pending_attachments",
    )) as Array<{ storage_key: string }>;
    expect(attachmentRows.length).toBe(3);
    const firstKey = attachmentRows[0]?.storage_key as string;
    expect(bytesEqual(await sourceBlobStore.readBytes(firstKey), PNG_1X1)).toBe(
      true,
    );

    // Restore the encrypted artifact into a SEPARATE fresh database + blob store.
    const decoded = await decodeBackupFile({
      password: PASSWORD,
      text: artifact.text,
    });
    await restoreBackupPayload({
      blobStore: targetBlobStore,
      execSql: targetExecSql,
      payload: decoded,
    });

    // The restored DB is what a fresh Playwright context would read.
    expect(await countRows(targetExecSql, "contact_projection")).toBe(1);
    expect(bytesEqual(await targetBlobStore.readBytes(firstKey), PNG_1X1)).toBe(
      true,
    );

    const restoredSdk = new Tearleads({
      database: { execSql: targetExecSql, id: "restored-db" },
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      logger: quietLogger,
      online: false,
    });
    const notes = await restoredSdk.documents.list({ documentKind: "note" });
    expect(notes?.totalCount).toBe(1);
    expect(notes?.rows[0]?.title).toBe("Launch checklist");

    const licenses = await restoredSdk.documents.list({
      documentKind: "drivers_license",
    });
    expect(licenses?.totalCount).toBe(1);
    expect(licenses?.rows[0]?.title).toBe("Driver's License D1234567");
  } finally {
    source.close();
    target.close();
  }
});
