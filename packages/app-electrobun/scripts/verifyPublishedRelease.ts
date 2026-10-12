import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  r2ReleaseAmbientCredentials,
  r2ReleaseCredentialProbe,
  r2ReleaseStorageStub,
} from "./r2Release.testUtils";

async function publishProbe(
  root: string,
  artifacts: string,
  env: Record<string, string | undefined>,
  channel: "stable" | "canary",
  appName: string,
) {
  // Copy only the publisher and replace its Terraform boundary inside the probe.
  // Production publication still always reads its real stack configuration.
  const probe = join(root, "publication-probe");
  const scripts = join(probe, "packages/app-electrobun/scripts");
  await mkdir(scripts, { recursive: true });
  for (const name of [
    "publishMacosRelease.ts",
    "publishDesktopRelease.ts",
    "desktopReleaseStorage.ts",
  ]) {
    await cp(join(import.meta.dirname, name), join(scripts, name));
  }
  await mkdir(join(probe, "terraform/scripts"), { recursive: true });
  await Bun.write(
    join(probe, "terraform/scripts/run-downloads-stack.sh"),
    r2ReleaseStorageStub,
  );
  const published = join(root, "published");
  await mkdir(published);
  await Bun.write(
    join(root, "bin/aws"),
    `#!/bin/sh\n${r2ReleaseCredentialProbe}\ncp "$3" "$PUBLICATION_PROBE_DIR/$(basename "$4")"\n`,
  );
  await chmod(join(root, "bin/aws"), 0o755);
  const prefix = `${channel}-macos-arm64`;
  const archive = join(artifacts, `${prefix}-${appName}.app.tar.zst`);
  const update = join(artifacts, `${prefix}-update.json`);
  const publisher = Bun.spawn(
    [
      process.execPath,
      join(scripts, "publishMacosRelease.ts"),
      channel === "stable"
        ? "tearleads-downloads-prod"
        : "tearleads-downloads-staging",
      channel,
      appName,
      join(
        artifacts,
        `${channel === "canary" ? "canary-" : ""}macos-arm64-${appName}.dmg`,
      ),
      update,
      archive,
    ],
    {
      env: {
        ...env,
        ...r2ReleaseAmbientCredentials,
        PUBLICATION_PROBE_DIR: published,
      },
      stdout: "ignore",
      stderr: "inherit",
    },
  );
  assert.equal(
    await publisher.exited,
    0,
    "The real generated release must publish",
  );

  return { published, prefix, archive, update };
}

export async function verifyPublishedRelease(
  root: string,
  artifacts: string,
  archivedView: string,
  env: Record<string, string | undefined>,
  channel: "stable" | "canary",
  appName: string,
) {
  const { published, prefix, archive, update } = await publishProbe(
    root,
    artifacts,
    env,
    channel,
    appName,
  );

  // Import the pinned vendor implementation at runtime without adding its
  // generated source files to the application's TypeScript project.
  const updater = await import(
    resolve(
      import.meta.dirname,
      "../.hutch/devkit/api/sdks/main/core/Updater.ts",
    )
  );
  const original = await Bun.file(update).json();
  const document = await Bun.file(
    join(published, `${prefix}-update.json`),
  ).json();
  const manifest = updater.validateUpdateManifest(document, {
    identifier: original.identifier,
    channel,
    platform: "macos",
    arch: "arm64",
  });
  assert.equal(manifest.version, original.version);
  assert.equal(manifest.hash, original.hash);
  assert.notEqual(manifest.artifact.file, original.artifact.file);
  const url = new URL(
    updater.buildUpdateArtifactUrl(
      "https://downloads.example.test",
      manifest.artifact.file,
    ),
  );
  const key = decodeURIComponent(url.pathname.slice(1));
  assert.equal(key, basename(key));
  const downloaded = join(root, "downloaded.tar.zst");
  const bytes = await updater.downloadResponseToFile(
    new Response(Bun.file(join(published, key))),
    downloaded,
    "Published update",
  );
  assert.equal(bytes, Bun.file(archive).size);
  assert.deepEqual(
    await Bun.file(downloaded).bytes(),
    await Bun.file(archive).bytes(),
  );
  const tar = join(root, "downloaded.tar");
  // Use the same decompressor and invocation as the installed updater.
  execFileSync(
    resolve(archivedView, "../../../../MacOS/zig-zstd"),
    ["decompress", "-i", downloaded, "-o", tar, "--no-timing"],
    { stdio: "ignore" },
  );
  assert.equal(await updater.readUpdateHashFromTar(tar), manifest.hash);
  console.log(
    "Electrobun validates published metadata, resolves the archive, and verifies its build hash.",
  );
}
