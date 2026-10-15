import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { validateSeedSpec } from "./validateSeedSpec";

export function seedDigest(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const require = createRequire(import.meta.url);

export async function loadContinuityAssets(
  seedPath = require.resolve("@a2f0/continuity/genesis/tearleads/seed.json"),
) {
  const root = dirname(dirname(seedPath));
  const manifest = JSON.parse(
    await readFile(join(root, "manifest.json"), "utf8"),
  ) as {
    files: { path: string; bytes: number; sha256: string }[];
  };
  const read = async (name: string) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(name))
      throw new Error(`Invalid seed asset name: ${name}`);
    const entries = manifest.files.filter(
      (file) => file.path === `tearleads/${name}`,
    );
    const entry = entries[0];
    const bytes = await readFile(join(root, "tearleads", name));
    if (
      entries.length !== 1 ||
      !entry ||
      entry.bytes !== bytes.length ||
      entry.sha256 !== seedDigest(bytes)
    )
      throw new Error(`Continuity manifest mismatch: ${name}`);
    return new Uint8Array(bytes);
  };
  const seedBytes = await read("seed.json");
  const spec: unknown = JSON.parse(new TextDecoder().decode(seedBytes));
  validateSeedSpec(spec);
  const expectations = await read("expectations.json");
  return {
    spec,
    readAttachment: read,
    seedSha256: seedDigest(seedBytes),
    expectationsSha256: seedDigest(expectations),
  };
}
