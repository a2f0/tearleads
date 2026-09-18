import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  verifyWindowsDownload,
  windowsReleaseNames,
} from "./windowsReleaseArtifacts";

export async function checkWindowsFixture(tier: string, failure = "") {
  const root = await mkdtemp(join(tmpdir(), "windows-archive-fixture-"));
  const names = windowsReleaseNames(tier);
  const commit = "a".repeat(40);
  const hash = "bbbbbbbbbbbbb";
  const tar =
    process.platform === "win32" ? "C:/Windows/System32/tar.exe" : "tar";
  async function write(path: string, content: string | Uint8Array) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, content);
  }
  try {
    const resources = `payload/${names.appName}/Resources`;
    const view = `${resources}/app/views/mainview`;
    for (const name of ["index.html", "worker.js", "sqlite3.wasm"]) {
      if (failure === name) continue;
      await write(
        `${view}/${name}`,
        name.endsWith(".wasm") ? new Uint8Array(1_000_001) : "fixture",
      );
    }
    await write(
      `${view}/main.js`,
      failure === "api"
        ? "https://wrong.example.test"
        : tier === "staging"
          ? "https://api-staging.tearleads.com"
          : "https://api.tearleads.com",
    );
    await write(`${resources}/version.json`, JSON.stringify({ hash }));
    await write(
      `${resources}/build.json`,
      JSON.stringify({
        defaultRenderer: failure === "cef" ? "native" : "cef",
        availableRenderers: ["cef"],
      }),
    );
    if (failure === "update-map") await write(`${view}/main.js.map`, "{}");
    const updateTar = join(root, "update.tar");
    execFileSync(tar, [
      "-cf",
      updateTar,
      "-C",
      join(root, "payload"),
      names.appName,
    ]);
    const archive = Bun.zstdCompressSync(
      await Bun.file(updateTar).arrayBuffer(),
    );
    await write(`build/artifacts/${names.archive}`, archive);
    await write(
      `build/artifacts/${names.update}`,
      JSON.stringify({
        schemaVersion: 1,
        identifier: "com.tearleads.app",
        channel: names.channel,
        platform: "win",
        arch: "x64",
        version: "0.1.0",
        hash: failure === "update-hash" ? "ccccccccccccc" : hash,
        artifact: { file: names.archive },
      }),
    );
    const setupStem =
      tier === "staging" ? "Tearleads-Setup-canary" : "Tearleads-Setup";
    if (failure !== "setup")
      await write(`setup/${setupStem}.exe`, "fixture setup executable");
    await write(
      `setup/.installer/${setupStem}.tar.zst`,
      failure === "payload"
        ? Bun.zstdCompressSync(new Uint8Array([1, 2, 3]))
        : archive,
    );
    await write(
      `setup/.installer/${setupStem}.metadata.json`,
      JSON.stringify({
        hash: failure === "installer-hash" ? "ccccccccccccc" : hash,
      }),
    );
    if (failure === "installer-map") await write("setup/setup.js.map", "{}");
    if (failure === "artifact-map")
      await write("build/artifacts/main.js.map", "{}");
    if (process.platform === "linux") {
      execFileSync(
        "zip",
        ["-qr", join(root, "build/artifacts", names.installer), "."],
        {
          cwd: join(root, "setup"),
        },
      );
    } else
      execFileSync(tar, [
        "--format",
        "zip",
        "-cf",
        join(root, "build/artifacts", names.installer),
        "-C",
        join(root, "setup"),
        ".",
      ]);
    // Exercise Electrobun's real manifest and streaming tar readers. The fixture
    // has its own package root while using the installed, pinned SDK module.
    const updater = new URL(
      "../.hutch/devkit/api/sdks/main/core/Updater.ts",
      import.meta.url,
    ).href;
    await write(
      ".hutch/devkit/api/sdks/main/core/Updater.ts",
      `export { validateUpdateManifest, readUpdateHashFromTar } from ${JSON.stringify(updater)};`,
    );
    // Match the native builder's one-verification-per-process lifecycle.
    const verifier = new URL("./verifyWindowsArtifacts.ts", import.meta.url)
      .href;
    await write(
      "check.ts",
      `import { verifyWindowsArtifacts } from ${JSON.stringify(verifier)};
await verifyWindowsArtifacts(${JSON.stringify(tier)}, ${JSON.stringify(root)}, ${JSON.stringify(commit)});`,
    );
    const child = Bun.spawn([process.execPath, join(root, "check.ts")], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (code !== 0) throw new Error(stderr || stdout);
    await verifyWindowsDownload(join(root, "build/artifacts"), tier, commit);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
