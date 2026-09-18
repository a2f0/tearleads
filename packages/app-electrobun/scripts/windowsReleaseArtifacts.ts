import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";

export function windowsReleaseNames(tier: string) {
  if (tier !== "staging" && tier !== "production")
    throw new Error("Windows release tier must be staging or production");
  const staging = tier === "staging";
  const channel = staging ? "canary" : "stable";
  const appName = staging ? "Tearleads-canary" : "Tearleads";
  return {
    channel,
    appName,
    bucket: staging
      ? "downloads-staging.tearleads.com"
      : "downloads.tearleads.com",
    installer: staging
      ? "canary-win-x64-Tearleads-Setup-canary.zip"
      : "win-x64-Tearleads-Setup.zip",
    update: `${channel}-win-x64-update.json`,
    archive: `${channel}-win-x64-${appName}.tar.zst`,
  };
}

export async function windowsArtifactDigest(path: string): Promise<string> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size === 0)
    throw new Error(`Missing or non-regular Windows artifact: ${path}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function assertWindowsRun(
  run: {
    event: string;
    conclusion: string;
    head_sha: string;
    path: string;
  },
  commit: string,
): void {
  if (
    run.event !== "workflow_dispatch" ||
    run.conclusion !== "success" ||
    run.head_sha !== commit ||
    run.path !== ".github/workflows/electrobun-windows.yml"
  )
    throw new Error(
      "Expected a successful manual Windows workflow for this checkout's HEAD",
    );
}

export async function verifyWindowsDownload(
  directory: string,
  tier: string,
  commit: string,
) {
  const names = windowsReleaseNames(tier);
  const manifest = await Bun.file(join(directory, "release.json")).json();
  if (
    manifest.tier !== tier ||
    manifest.commit !== commit ||
    manifest.target !== "win-x64"
  )
    throw new Error("Windows artifact provenance does not match this release");
  for (const name of [names.installer, names.update, names.archive]) {
    if (
      manifest.sha256?.[name] !==
      (await windowsArtifactDigest(join(directory, name)))
    )
      throw new Error(`Windows artifact checksum mismatch: ${name}`);
  }
  const update = await Bun.file(join(directory, names.update)).json();
  if (
    update.channel !== names.channel ||
    update.platform !== "win" ||
    update.arch !== "x64" ||
    update.identifier !== "com.tearleads.app"
  )
    throw new Error("Windows update manifest does not match this release");
  return names;
}
