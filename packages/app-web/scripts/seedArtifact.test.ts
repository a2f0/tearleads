import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSeedArtifactCurrent } from "../screenshots/seedArtifact";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test("screenshot capture rejects modified backups and mismatched seed provenance", () => {
  const root = mkdtempSync(join(tmpdir(), "seed-provenance-"));
  roots.push(root);
  const path = join(root, "seed.json");
  const require = createRequire(import.meta.url);
  const digest = (bytes: string | Buffer) =>
    createHash("sha256").update(bytes).digest("hex");
  const provenance = {
    schemaVersion: 2,
    artifactSha256: digest("backup"),
    seedSha256: digest(
      readFileSync(
        require.resolve("@a2f0/continuity/genesis/tearleads/seed.json"),
      ),
    ),
    expectationsSha256: digest(
      readFileSync(
        require.resolve("@a2f0/continuity/genesis/tearleads/expectations.json"),
      ),
    ),
  };
  writeFileSync(path, "backup");
  expect(() => assertSeedArtifactCurrent(path)).toThrow(
    "Run bun run screenshots:seed",
  );
  writeFileSync(`${path}.provenance.json`, JSON.stringify(provenance));
  expect(() => assertSeedArtifactCurrent(path)).not.toThrow();
  writeFileSync(path, "modified");
  expect(() => assertSeedArtifactCurrent(path)).toThrow("stale or modified");
  writeFileSync(path, "backup");
  writeFileSync(
    `${path}.provenance.json`,
    JSON.stringify({ ...provenance, seedSha256: "old-pin" }),
  );
  expect(() => assertSeedArtifactCurrent(path)).toThrow("stale or modified");
});
