import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export async function checkLinuxFixture(
  tier: "staging" | "production",
  failure = "",
) {
  const root = await mkdtemp(join(tmpdir(), "tearleads-artifact-fixture-"));
  const channel = tier === "staging" ? "canary" : "stable";
  const app = tier === "staging" ? "Tearleads-canary" : "Tearleads";
  const prefix = `${channel}-linux-x64`;
  const installerPrefix = tier === "staging" ? "canary-linux-x64" : "linux-x64";
  async function write(path: string, content: string | Uint8Array) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, content);
  }
  try {
    await write("setup/installer", "fixture installer");
    await write("setup/README.txt", "fixture readme");
    const artifacts = join(root, "build/artifacts");
    await mkdir(artifacts, { recursive: true });
    execFileSync("tar", [
      "-czf",
      join(artifacts, `${installerPrefix}-${app}-Setup.tar.gz`),
      "-C",
      join(root, "setup"),
      failure === "installer" ? "README.txt" : "installer",
    ]);
    const view = `payload/${app}/Resources/app/views/mainview`;
    for (const name of ["index.html", "worker.js", "sqlite3.wasm"]) {
      if (failure === name) continue;
      await write(
        `${view}/${name}`,
        name.endsWith(".wasm") ? new Uint8Array(1_000_001) : "fixture",
      );
    }
    const api =
      tier === "staging"
        ? "https://api-staging.tearleads.com"
        : "https://api.tearleads.com";
    await write(
      `${view}/main.js`,
      failure === "api" ? "https://wrong.example.test" : api,
    );
    await write(
      "payload/version.json",
      JSON.stringify({ hash: "archive-hash" }),
    );
    const tar = join(root, "update.tar");
    execFileSync("tar", [
      "-cf",
      tar,
      "-C",
      join(root, "payload"),
      app,
      "version.json",
    ]);
    await write(
      `build/artifacts/${prefix}-${app}.tar.zst`,
      Bun.zstdCompressSync(await Bun.file(tar).arrayBuffer()),
    );
    const manifest = {
      identifier: "com.tearleads.app",
      channel,
      platform: "linux",
      arch: "x64",
      hash: failure === "hash" ? "wrong-hash" : "archive-hash",
    };
    await write(
      `build/artifacts/${prefix}-update.json`,
      JSON.stringify(manifest),
    );
    await write(
      ".hutch/devkit/api/sdks/main/core/Updater.ts",
      `
      import { strict as assert } from "node:assert";
      import { execFileSync } from "node:child_process";
      export function validateUpdateManifest(value, expected) {
        assert.deepEqual(expected, ${JSON.stringify({ identifier: "com.tearleads.app", channel, platform: "linux", arch: "x64" })});
        for (const [key, field] of Object.entries(expected)) assert.equal(value[key], field);
        return value;
      }
      export async function readUpdateHashFromTar(path) {
        return JSON.parse(execFileSync("tar", ["-xOf", path, "version.json"], {encoding: "utf8"})).hash;
      }
    `,
    );
    if (failure === "filename")
      await rm(join(artifacts, `${prefix}-update.json`));
    // Decode real zstd data with Bun in host tests; the container checks exercise
    // the system zstd executable used by releases without adding a host dependency.
    await write(
      "bin/zstd",
      "#!/usr/bin/env bun\nawait Bun.write(process.argv[5], Bun.zstdDecompressSync(await Bun.file(process.argv[3]).arrayBuffer()));",
    );
    await chmod(join(root, "bin/zstd"), 0o755);
    await symlink(process.execPath, join(root, "bin/bun"));
    const verifier = new URL("./verifyLinuxArtifacts.ts", import.meta.url).href;
    await write(
      "check.ts",
      `import { verifyLinuxArtifacts } from ${JSON.stringify(verifier)}; await verifyLinuxArtifacts(${JSON.stringify(tier)}, process.argv[2]);`,
    );
    const { PATH: inheritedPath } = process.env;
    const child = Bun.spawn([process.execPath, join(root, "check.ts"), root], {
      env: { ...process.env, PATH: `${root}/bin:${inheritedPath}` },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) throw new Error(stderr || stdout);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
