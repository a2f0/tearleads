import { createMemoryBlobStore } from "@tearleads/client-sdk";
import type { ExecSql } from "@tearleads/client-sdk/sqlite";
import { createTestExecSql } from "@tearleads/test-utils";
import { buildSeedArtifact } from "./buildSeedArtifact";
import type { SeedSpec } from "./seedTypes";

// CLI that regenerates the committed screenshot seed artifact:
//   bun run screenshots:seed
//
// Reads fixtures/seed.json + its referenced attachment files, drives the client
// -sdk write path headlessly into an in-memory chacha20 SQLite + memory blob
// store, and writes fixtures/tearleads-seed.tlbackup.json — the artifact the
// Playwright screenshot run restores through the backup-restore mini-app.

const FIXTURES_DIR = `${import.meta.dir}/fixtures`;
const SPEC_PATH = `${FIXTURES_DIR}/seed.json`;
const ARTIFACT_PATH = `${FIXTURES_DIR}/tearleads-seed.tlbackup.json`;

async function main(): Promise<void> {
  const spec = (await Bun.file(SPEC_PATH).json()) as SeedSpec;
  const database = await createTestExecSql("screenshot-seed-build-key");
  try {
    const artifact = await buildSeedArtifact(spec, {
      blobStore: createMemoryBlobStore(),
      execSql: database.execSql as ExecSql,
      readAttachment: async (fileRef) =>
        new Uint8Array(
          await Bun.file(`${FIXTURES_DIR}/${fileRef}`).arrayBuffer(),
        ),
    });
    await Bun.write(ARTIFACT_PATH, artifact.text);
    console.log(
      `Wrote ${ARTIFACT_PATH} — ${artifact.summary.rowCount} rows, ${artifact.summary.blobCount} blobs.`,
    );
  } finally {
    database.close();
  }
}

if (import.meta.main) {
  await main();
}
