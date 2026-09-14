import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type Updater = {
  validateUpdateManifest(
    value: unknown,
    expected: {
      identifier: string;
      channel: string;
      platform: string;
      arch: string;
    },
  ): { hash: string };
  readUpdateHashFromTar(path: string): Promise<string>;
};

export async function verifyLinuxArtifacts(
  tier: "staging" | "production",
  packageRoot: string,
): Promise<void> {
  const channel = tier === "staging" ? "canary" : "stable";
  const app = tier === "staging" ? "Tearleads-canary" : "Tearleads";
  const prefix = `${channel}-linux-x64`;
  const artifacts = join(packageRoot, "build/artifacts");
  const installerPrefix = tier === "staging" ? "canary-linux-x64" : "linux-x64";
  const temporary = await mkdtemp(join(tmpdir(), "tearleads-linux-artifacts-"));
  try {
    const installer = join(artifacts, `${installerPrefix}-${app}-Setup.tar.gz`);
    const contents = execFileSync("tar", ["-tzf", installer], {
      encoding: "utf8",
    });
    assert.match(contents, /(?:^|\/)installer\n/);
    const tar = join(temporary, "update.tar");
    execFileSync(
      "zstd",
      ["-d", join(artifacts, `${prefix}-${app}.tar.zst`), "-o", tar],
      { stdio: "ignore" },
    );
    const updater = (await import(
      join(packageRoot, ".hutch/devkit/api/sdks/main/core/Updater.ts")
    )) as Updater;
    assert.equal(typeof updater.validateUpdateManifest, "function");
    assert.equal(typeof updater.readUpdateHashFromTar, "function");
    const manifest = updater.validateUpdateManifest(
      await Bun.file(join(artifacts, `${prefix}-update.json`)).json(),
      {
        identifier: "com.tearleads.app",
        channel,
        platform: "linux",
        arch: "x64",
      },
    );
    assert.equal(await updater.readUpdateHashFromTar(tar), manifest.hash);
    execFileSync("tar", ["-xf", tar, "-C", temporary]);
    const resources = join(temporary, app, "Resources");
    const view = join(resources, "app/views/mainview");
    await access(join(view, "index.html"));
    await access(join(view, "worker.js"));
    assert.ok(Bun.file(join(view, "sqlite3.wasm")).size > 1_000_000);
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
    console.log(
      `Verified Linux ${tier} installer, updater hash, renderer, and SQLite assets.`,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const tier = process.argv[2];
  if (
    process.platform !== "linux" ||
    (tier !== "staging" && tier !== "production")
  )
    throw new Error(
      "Usage on Linux: bun verifyLinuxArtifacts.ts <staging|production>",
    );
  await verifyLinuxArtifacts(tier, resolve(import.meta.dirname, ".."));
}
