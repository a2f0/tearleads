import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadContinuityAssets, seedDigest } from "./continuityAssets";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "seed-assets-"));
  roots.push(root);
  await mkdir(join(root, "tearleads"));
  const contents = {
    "seed.json": JSON.stringify({
      schemaVersion: 3,
      identitySeedPhrase: "fixture",
      contacts: [
        {
          id: "fixture",
          fields: { firstName: "Fixture" },
          avatar: { file: "photo.jpg", mimeType: "image/jpeg" },
        },
      ],
    }),
    "expectations.json": "{}",
    "photo.jpg": "photo bytes",
  };
  const files: Array<{ path: string; bytes: number; sha256: string }> = [];
  for (const [name, bytes] of Object.entries(contents)) {
    await writeFile(join(root, "tearleads", name), bytes);
    files.push({
      path: `tearleads/${name}`,
      bytes: Buffer.byteLength(bytes),
      sha256: seedDigest(bytes),
    });
  }
  const save = () =>
    writeFile(join(root, "manifest.json"), JSON.stringify({ files }));
  await save();
  return { root, files, save, seed: join(root, "tearleads/seed.json") };
}

test("seed assets verify every attachment against its manifest before use", async () => {
  const { root, seed } = await fixture();
  const assets = await loadContinuityAssets(seed);
  expect(
    new TextDecoder().decode(await assets.readAttachment("photo.jpg")),
  ).toBe("photo bytes");
  await writeFile(join(root, "tearleads/photo.jpg"), "other bytes");
  await expect(assets.readAttachment("photo.jpg")).rejects.toThrow(
    "manifest mismatch",
  );
  await expect(assets.readAttachment("../manifest.json")).rejects.toThrow(
    "Invalid seed asset name",
  );
});

test("changing only fixture bytes changes the account seed identity", async () => {
  const { files, root, seed, save } = await fixture();
  const before = await loadContinuityAssets(seed);
  const photo = files.find((file) => file.path === "tearleads/photo.jpg");
  if (!photo) throw new Error("Missing fixture photo");
  const replacement = "replacement photo";
  await writeFile(join(root, photo.path), replacement);
  photo.bytes = Buffer.byteLength(replacement);
  photo.sha256 = seedDigest(replacement);
  await save();
  const after = await loadContinuityAssets(seed);
  expect(after.seedSha256).toBe(before.seedSha256);
  expect(after.datasetSha256).not.toBe(before.datasetSha256);
});

for (const corruption of ["missing", "duplicate", "size", "hash"] as const) {
  test(`seed assets reject ${corruption} manifest entries`, async () => {
    const { files, save, seed } = await fixture();
    const entry = files[0];
    if (!entry) throw new Error("Missing fixture entry");
    if (corruption === "missing") files.shift();
    if (corruption === "duplicate") files.push({ ...entry });
    if (corruption === "size") entry.bytes++;
    if (corruption === "hash") entry.sha256 = "0".repeat(64);
    await save();
    await expect(loadContinuityAssets(seed)).rejects.toThrow(
      "manifest mismatch: seed.json",
    );
  });
}
