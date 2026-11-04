import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Diagnostic imports into the installed package, not additional public exports.
// Keep the source-owned regression bodies unchanged so the workspace and package
// gates exercise the same history contract through their respective wrappers.
export function writeHistorySmoke(projectDir: string) {
  let tests = readFileSync(
    join(import.meta.dir, "../../loro/src/historyIdentity.test.ts"),
    "utf8",
  );
  const imports = {
    '"@tearleads/encoding"':
      '"./node_modules/@tearleads/client-sdk/internal/encoding/index.js"',
    '"./document"':
      '"./node_modules/@tearleads/client-sdk/internal/loro/document.js"',
    '"./updateIdentity"':
      '"./node_modules/@tearleads/client-sdk/internal/loro/updateIdentity.js"',
  };
  for (const [source, installed] of Object.entries(imports)) {
    if (tests.split(source).length !== 2) {
      throw new Error(`history smoke import changed: ${source}`);
    }
    tests = tests.replace(source, installed);
  }
  writeFileSync(join(projectDir, "historyIdentity.test.ts"), tests);
  writeFileSync(join(projectDir, "history-smoke.mjs"), nodeHistorySmoke);
}

// Node must execute the installed wrapper too: testing loro-crdt directly or
// comparing only document text/version vectors misses SDK provenance failures.
const nodeHistorySmoke = `import assert from "node:assert/strict";
const sdkRoot = new URL(".", import.meta.resolve("@tearleads/client-sdk"));
const {
  createDocument, encodeVersionVector, exportFullHistoryIdentity,
  exportFullHistorySnapshot, exportUpdatesSince, importSnapshot, importUpdates,
  versionVectorsEqual,
} = await import(new URL("internal/loro/document.js", sdkRoot));

const source = await createDocument("segmented-history-source");
const restored = await createDocument("segmented-history-restored");
const replayed = await createDocument("segmented-history-replayed");
try {
  source.getText("text").update("survives key");
  source.commit();
  const first = exportUpdatesSince(source);
  const firstVersion = encodeVersionVector(source);
  source.getText("text").update("survives key rotation");
  source.commit();
  const second = exportUpdatesSince(source, firstVersion);
  importSnapshot(restored, exportFullHistorySnapshot(source));
  importUpdates(replayed, [first, second]);
  const version = encodeVersionVector(restored);
  assert.equal(versionVectorsEqual(encodeVersionVector(replayed), version), true);
  assert.equal(restored.getText("text").toString(), "survives key rotation");
  assert.equal(replayed.getText("text").toString(), "survives key rotation");
  assert.equal(exportFullHistoryIdentity(replayed, version),
    exportFullHistoryIdentity(restored));
} finally {
  source.free();
  restored.free();
  replayed.free();
}
`;
