import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type ReleasePublication = {
  bucket: string;
  channel: string;
  appName: string;
  installer: string;
  update: string;
  archive: string;
  target: "macos-arm64" | "linux-x64" | "win-x64";
};

async function digest(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
async function upload(
  bucket: string,
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
async function readReleaseManifest(
  path: string,
  channel: string,
  platform: string,
  arch: string,
) {
  const metadata: unknown = await Bun.file(path).json();
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata) ||
    !("channel" in metadata) ||
    metadata.channel !== channel ||
    !("platform" in metadata) ||
    metadata.platform !== platform ||
    !("arch" in metadata) ||
    metadata.arch !== arch
  )
    throw new Error("Update manifest does not match this desktop release");

  return metadata;
}

export async function publishDesktopRelease({
  bucket,
  channel,
  appName,
  installer,
  update,
  archive,
  target,
}: ReleasePublication): Promise<void> {
  if (
    !["stable", "canary"].includes(channel) ||
    !/^[A-Za-z0-9-]+$/.test(appName)
  )
    throw new Error("Invalid desktop release channel or app name");
  const [platform, arch] = target.split("-");
  const installerExtension =
    platform === "macos"
      ? ".dmg"
      : platform === "win"
        ? "-Setup.zip"
        : "-Setup.tar.gz";
  const archiveExtension = platform === "macos" ? ".app.tar.zst" : ".tar.zst";
  const [installerHash, archiveHash] = await Promise.all([
    digest(installer),
    digest(archive),
  ]);
  const prefix = `${channel}-${target}`;
  const installerKey = `${prefix}-${installerHash}-${appName}${installerExtension}`;
  const archiveKey = `${prefix}-${archiveHash}-${appName}${archiveExtension}`;
  const metadata = await readReleaseManifest(
    update,
    channel,
    platform ?? "",
    arch ?? "",
  );
  const temp = await mkdtemp(join(tmpdir(), "tearleads-publication-"));
  try {
    const checksum = join(temp, `${installerKey}.sha256`);
    const updateManifest = join(temp, `${prefix}-update.json`);
    const downloadsManifest = join(temp, `${prefix}-download.json`);
    await Bun.write(checksum, `${installerHash}  ${installerKey}\n`);
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
    await upload(
      bucket,
      installer,
      installerKey,
      "application/octet-stream",
      true,
    );
    await upload(
      bucket,
      checksum,
      `${installerKey}.sha256`,
      "text/plain",
      true,
    );
    await upload(bucket, archive, archiveKey, "application/octet-stream", true);
    // Each discovery document switches its complete set of references atomically.
    await upload(
      bucket,
      updateManifest,
      `${prefix}-update.json`,
      "application/json",
      false,
    );
    await upload(
      bucket,
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
}
