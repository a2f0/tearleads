import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  windowsArtifactDigest,
  windowsReleaseNames,
} from "./windowsReleaseArtifacts";

async function verifyRendererAssets(resources: string, tier: string) {
  const view = join(resources, "app/views/mainview");
  assert.ok(await Bun.file(join(view, "index.html")).exists());
  assert.ok(await Bun.file(join(view, "worker.js")).exists());
  assert.ok(Bun.file(join(view, "sqlite3.wasm")).size > 1_000_000);
  const metadata = await Bun.file(join(resources, "build.json")).json();
  assert.equal(metadata.defaultRenderer, "cef");
  assert.ok(metadata.availableRenderers.includes("cef"));
  const chunks = (await readdir(view)).filter((name) => name.endsWith(".js"));
  const scripts = (
    await Promise.all(chunks.map((name) => Bun.file(join(view, name)).text()))
  ).join("\n");
  assert.ok(
    scripts.includes(
      tier === "staging"
        ? "https://api-staging.tearleads.com"
        : "https://api.tearleads.com",
    ),
  );
}

async function writeReleaseManifest(
  artifacts: string,
  tier: string,
  commit: string,
) {
  const names = windowsReleaseNames(tier);
  const files = [names.installer, names.update, names.archive];
  const sha256 = Object.fromEntries(
    await Promise.all(
      files.map(async (name) => [
        name,
        await windowsArtifactDigest(join(artifacts, name)),
      ]),
    ),
  );
  await Bun.write(
    join(artifacts, `${names.installer}.sha256`),
    `${sha256[names.installer]}  ${names.installer}\n`,
  );
  await Bun.write(
    join(artifacts, "release.json"),
    JSON.stringify({ tier, commit, target: "win-x64", sha256 }, null, 2),
  );
}

async function verifyUpdateHash(
  packageRoot: string,
  artifacts: string,
  tier: string,
  updateTar: string,
  installerHash: unknown,
) {
  const names = windowsReleaseNames(tier);
  const updaterPath = join(
    packageRoot,
    ".hutch/devkit/api/sdks/main/core/Updater.ts",
  );
  const updater = await import(updaterPath);
  const manifest = updater.validateUpdateManifest(
    await Bun.file(join(artifacts, names.update)).json(),
    {
      identifier: "com.tearleads.app",
      channel: names.channel,
      platform: "win",
      arch: "x64",
    },
  );
  const updateHash = execFileSync(
    process.execPath,
    [
      join(import.meta.dirname, "readWindowsUpdateHash.ts"),
      updaterPath,
      updateTar,
    ],
    { encoding: "utf8" },
  ).trim();
  assert.equal(updateHash, manifest.hash);
  assert.equal(installerHash, manifest.hash);
}

export async function verifyWindowsArtifacts(
  tier: string,
  packageRoot: string,
  commit: string,
): Promise<void> {
  const names = windowsReleaseNames(tier);
  assert.match(commit ?? "", /^[a-f0-9]{40}$/);
  const artifacts = join(packageRoot, "build/artifacts");
  const temp = await mkdtemp(join(tmpdir(), "windows-artifacts-"));
  try {
    // Windows' bsdtar understands both the installer ZIP and the update tar.
    const tar =
      process.platform === "win32" ? "C:/Windows/System32/tar.exe" : "tar";
    const list = (path: string) =>
      execFileSync(tar, ["-tf", path], { encoding: "utf8" }).split(/\r?\n/);
    const installerContents = list(join(artifacts, names.installer));
    assert.ok(
      installerContents.some((name) => name.endsWith(".exe")),
      "Missing setup executable",
    );
    assert.ok(
      installerContents.some((name) => name.endsWith(".tar.zst")),
      "Missing installer payload",
    );
    const installerRoot = join(temp, "installer");
    await mkdir(installerRoot);
    execFileSync(tar, [
      "-xf",
      join(artifacts, names.installer),
      "-C",
      installerRoot,
    ]);
    const setupStem =
      tier === "staging" ? "Tearleads-Setup-canary" : "Tearleads-Setup";
    assert.ok(await Bun.file(join(installerRoot, `${setupStem}.exe`)).exists());
    assert.equal(
      await windowsArtifactDigest(
        join(installerRoot, ".installer", `${setupStem}.tar.zst`),
      ),
      await windowsArtifactDigest(join(artifacts, names.archive)),
      "Installer payload must match the updater archive",
    );
    const installerMetadata = await Bun.file(
      join(installerRoot, ".installer", `${setupStem}.metadata.json`),
    ).json();
    const updateTar = join(temp, "update.tar");
    await Bun.write(
      updateTar,
      Bun.zstdDecompressSync(
        await Bun.file(join(artifacts, names.archive)).arrayBuffer(),
      ),
    );
    const paths = list(updateTar);
    assert.ok(
      ![...paths, ...installerContents, ...(await readdir(artifacts))].some(
        (name) => name.endsWith(".map"),
      ),
      "Source maps must not ship",
    );
    await verifyUpdateHash(
      packageRoot,
      artifacts,
      tier,
      updateTar,
      installerMetadata.hash,
    );
    execFileSync(tar, ["-xf", updateTar, "-C", temp]);
    await verifyRendererAssets(join(temp, names.appName, "Resources"), tier);
    await writeReleaseManifest(artifacts, tier, commit);
    console.log(
      `Verified Windows ${tier} installer, updater hash, CEF, renderer, and SQLite assets.`,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { BUILD_GIT_SHA: commit } = process.env;
  await verifyWindowsArtifacts(
    process.argv[2] ?? "",
    resolve(import.meta.dirname, ".."),
    commit ?? "",
  );
}
