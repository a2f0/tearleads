import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [bucket, channel, appName, dmg, update, archive] = process.argv.slice(2);
if (
  !bucket ||
  !appName ||
  !dmg ||
  !update ||
  !archive ||
  !["stable", "canary"].includes(channel ?? "") ||
  process.argv.length !== 8
)
  throw new Error(
    "Expected bucket, channel, app name, DMG, update manifest, and archive",
  );

async function digest(path: string) {
  return createHash("sha256")
    .update(await Bun.file(path).bytes())
    .digest("hex");
}
const [dmgHash, archiveHash] = await Promise.all([
  digest(dmg),
  digest(archive),
]);
const prefix = `${channel}-macos-arm64`;
const installerKey = `${prefix}-${dmgHash}-${appName}.dmg`;
const archiveKey = `${prefix}-${archiveHash}-${appName}.app.tar.zst`;
const metadata: unknown = await Bun.file(update).json();
if (
  typeof metadata !== "object" ||
  metadata === null ||
  Array.isArray(metadata) ||
  !("channel" in metadata) ||
  metadata.channel !== channel ||
  !("platform" in metadata) ||
  metadata.platform !== "macos" ||
  !("arch" in metadata) ||
  metadata.arch !== "arm64"
)
  throw new Error("Update manifest does not match this macOS release");

const temp = await mkdtemp(join(tmpdir(), "tearleads-publication-"));
async function upload(
  path: string,
  key: string,
  contentType: string,
  immutable: boolean,
) {
  const child = Bun.spawn(
    [
      "aws",
      "s3",
      "cp",
      path,
      `s3://${bucket}/${key}`,
      "--region",
      "us-east-1",
      "--only-show-errors",
      "--content-type",
      contentType,
      "--cache-control",
      immutable
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate",
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  const code = await child.exited;
  if (code !== 0) throw new Error(`Release upload failed (${code}): ${key}`);
}
try {
  const checksum = join(temp, `${installerKey}.sha256`);
  const updateManifest = join(temp, `${prefix}-update.json`);
  const downloadsManifest = join(temp, `${prefix}-download.json`);
  await Bun.write(checksum, `${dmgHash}  ${installerKey}\n`);
  await Bun.write(
    updateManifest,
    JSON.stringify({ ...metadata, artifact: { file: archiveKey } }),
  );
  await Bun.write(
    downloadsManifest,
    JSON.stringify({
      installer: installerKey,
      checksum: `${installerKey}.sha256`,
    }),
  );
  // Content-derived keys preserve every previously published payload and checksum.
  await upload(dmg, installerKey, "application/octet-stream", true);
  await upload(checksum, `${installerKey}.sha256`, "text/plain", true);
  await upload(archive, archiveKey, "application/octet-stream", true);
  // Each discovery document switches its complete set of references atomically.
  await upload(
    updateManifest,
    `${prefix}-update.json`,
    "application/json",
    false,
  );
  await upload(
    downloadsManifest,
    `${prefix}-download.json`,
    "application/json",
    false,
  );
  console.log(
    `Download: https://s3.us-east-1.amazonaws.com/${bucket}/${installerKey}`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
