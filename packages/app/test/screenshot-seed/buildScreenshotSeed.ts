import { resolve } from "node:path";
import { createMemoryBlobStore } from "@symcrypt/client-sdk";
import type { ExecSql } from "@symcrypt/client-sdk/sqlite";
import { createTestExecSql } from "@symcrypt/test-utils";
import { buildSeedArtifact } from "./buildSeedArtifact";
import type { SeedSpec } from "./seedTypes";

// CLI that regenerates the screenshot seed artifact:
//   bun run screenshots:seed
//
// Reads fixtures/seed.json + its referenced attachment files, drives the client
// -sdk write path headlessly into an in-memory chacha20 SQLite + memory blob
// store, and writes symcrypt-seed.scbackup.json at the repo root — the artifact
// the Playwright screenshot run restores through the backup-restore mini-app.
// The artifact is gitignored (its bytes are non-deterministic) and regenerated
// on demand, so it lives at the root where it is easy to find for a manual
// restore rather than buried in the fixtures directory.

// This file is packages/app/test/screenshot-seed/buildScreenshotSeed.ts, so the
// repo root is four levels up.
const REPO_ROOT = resolve(import.meta.dir, "../../../..");
const FIXTURES_DIR = `${import.meta.dir}/fixtures`;
const SPEC_PATH = `${FIXTURES_DIR}/seed.json`;
const ARTIFACT_PATH = resolve(REPO_ROOT, "symcrypt-seed.scbackup.json");

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
    // Print everything a manual restore needs — the file path plus the two
    // credentials the encrypted backup is bound to — so the artifact can be
    // restored by hand (outside the Playwright run) without opening seed.json.
    console.log(
      [
        `Wrote seed backup: ${ARTIFACT_PATH}`,
        `  ${artifact.summary.rowCount} rows, ${artifact.summary.blobCount} blobs`,
        "",
        "Restore it manually in the app:",
        "  1. Identity Manager -> Restore from Passphrase:",
        `       ${spec.identitySeedPhrase}`,
        "  2. Backup / Restore -> Restore -> choose the file above, password:",
        `       ${spec.password}`,
      ].join("\n"),
    );
  } finally {
    database.close();
  }
}

if (import.meta.main) {
  await main();
}
