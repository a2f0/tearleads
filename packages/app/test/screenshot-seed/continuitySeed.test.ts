import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import type { ExecSql } from "@tearleads/client-sdk/sqlite";
import { createTestExecSql } from "@tearleads/test-utils";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../src/document-types/projectors";
import { decodeBackupFile } from "../../src/providers/db/localBackupFormat";
import { buildSeedArtifact } from "./buildSeedArtifact";
import type { SeedSpec } from "./seedTypes";

const require = createRequire(import.meta.url);
const seedPath = require.resolve(
  "@a2f0/continuity/genesis/tearleads/seed.json",
);
const assets = dirname(seedPath);

test("pinned Continuity data builds the documents and images promised to screenshot capture", async () => {
  const spec: SeedSpec = await Bun.file(seedPath).json();
  const expected = await Bun.file(join(assets, "expectations.json")).json();
  const database = await createTestExecSql("continuity-contract-test");
  const blobStore = createMemoryBlobStore();
  const sdk = new Tearleads({
    blobStoreFactory: () => blobStore,
    database: {
      execSql: database.execSql as ExecSql,
      id: "continuity-contract",
    },
    documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
    logger: { log: () => undefined, logError: () => undefined },
    online: false,
  });
  try {
    const artifact = await buildSeedArtifact(spec, {
      blobStore,
      execSql: database.execSql as ExecSql,
      readAttachment: async (file) =>
        new Uint8Array(await Bun.file(join(assets, file)).arrayBuffer()),
    });
    const payload = await decodeBackupFile({
      password: spec.password,
      text: artifact.text,
    });
    const avatarCount =
      spec.contacts?.filter((contact) => contact.avatar).length ?? 0;
    expect(avatarCount).toBeGreaterThan(0);
    expect(payload.summary.blobCount).toBe(
      avatarCount +
        expected.driversLicense.imageCount +
        expected.passport.imageCount +
        expected.birthCertificate.imageCount +
        expected.creditCard.imageCount,
    );

    const contacts = await sdk.documents.list({ documentKind: "contact" });
    expect(contacts?.totalCount).toBe(spec.contacts?.length);
    expect(contacts?.rows.map((row) => row.title)).toContain(
      expected.contact.displayName,
    );
    const notes = await sdk.documents.list({ documentKind: "note" });
    expect(notes?.totalCount).toBe(spec.notes?.length);
    expect(notes?.rows.map((row) => row.title)).toContain(expected.note.title);
    expect(
      spec.notes?.some(
        (note) =>
          note.text.startsWith(expected.note.title) &&
          note.text.includes(expected.note.bodyLine),
      ),
    ).toBe(true);

    for (const [kind, detail] of [
      ["drivers_license", expected.driversLicense],
      ["passport", expected.passport],
      ["birth_certificate", expected.birthCertificate],
      ["credit_card", expected.creditCard],
    ] as const) {
      const documents = await sdk.documents.list({ documentKind: kind });
      expect(documents?.totalCount).toBe(1);
      expect(documents?.rows[0]?.title).toBe(detail.title);
      const attachments = (await database.execSql(
        "SELECT COUNT(*) AS count FROM document_pending_attachments AS a JOIN document_projection AS d ON a.local_id = d.local_id WHERE d.document_kind = ?",
        [kind],
      )) as Array<{ count: number }>;
      expect(attachments[0]?.count).toBe(detail.imageCount);
    }
  } finally {
    sdk.dispose();
    database.close();
  }
});
