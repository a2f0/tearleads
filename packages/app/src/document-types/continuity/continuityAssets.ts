import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { validateSeedSpec } from "./validateSeedSpec";

export function seedDigest(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const require = createRequire(import.meta.url);

export async function loadContinuityAssets(
  seedPath = require.resolve("@a2f0/continuity/genesis/tearleads/seed.json"),
) {
  const root = dirname(dirname(seedPath));
  const manifest: unknown = JSON.parse(
    await readFile(join(root, "manifest.json"), "utf8"),
  );
  const { files } = isPlainObject(manifest) ? manifest : {};
  if (!Array.isArray(files) || !files.every(isPlainObject)) {
    throw new Error("Invalid Continuity manifest file list");
  }
  const read = async (name: string) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(name))
      throw new Error(`Invalid seed asset name: ${name}`);
    const entries = files.filter(({ path }) => path === `tearleads/${name}`);
    const { bytes: expectedBytes, sha256 } = entries[0] ?? {};
    const bytes = await readFile(join(root, "tearleads", name));
    if (
      entries.length !== 1 ||
      expectedBytes !== bytes.length ||
      sha256 !== seedDigest(bytes)
    )
      throw new Error(`Continuity manifest mismatch: ${name}`);
    return new Uint8Array(bytes);
  };
  const seedBytes = await read("seed.json");
  const spec: unknown = JSON.parse(new TextDecoder().decode(seedBytes));
  validateSeedSpec(spec);
  const attachmentNames = new Set([
    ...(spec.contacts ?? []).flatMap((contact) =>
      contact.avatar ? [contact.avatar.file] : [],
    ),
    ...(spec.files ?? []).flatMap((file) =>
      file.attachments.map((attachment) => attachment.file),
    ),
  ]);
  const seedSha256 = seedDigest(seedBytes);
  const digests = [seedSha256];
  for (const name of attachmentNames)
    digests.push(seedDigest(await read(name)));
  const expectations = await read("expectations.json");
  return {
    spec,
    readAttachment: read,
    seedSha256,
    datasetSha256: seedDigest(JSON.stringify(digests)),
    expectationsSha256: seedDigest(expectations),
  };
}
