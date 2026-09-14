import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPlatformReleases } from "./platformSourceMaps.testUtils";
import { startFakeSentry } from "./sentrySourceMapUpload.testUtils";

test("one commit's macOS and Linux builds upload same-URL maps under distinct dists, each the dist its own runtime reports", async () => {
  const root = await mkdtemp(join(tmpdir(), "platform-sourcemaps-"));
  const bundlePath = join(root, "bundle.zip");
  const sentry = startFakeSentry(bundlePath, false);
  try {
    const { head, macos, linux } = await runPlatformReleases(
      sentry.url,
      bundlePath,
    );
    const release = `tearleads-electrobun@${head}`;
    expect([...sentry.releases]).toEqual([
      `${release} staging-app-macos-arm64`,
      `${release} staging-app-linux-x64`,
    ]);
    for (const [build, dist] of [
      [macos, "staging-app-macos-arm64"],
      [linux, "staging-app-linux-x64"],
    ] as const) {
      expect(build.uploaded).toMatchObject({ release, dist });
      expect(build.dists).toEqual({ main: dist, renderer: dist });
      // The main-process bundle uploaded under that dist is the one this
      // build ships.
      expect(build.uploaded.main).toBe(build.packagedMain);
    }
    // Only the dist tells the two builds' artifacts apart.
    expect(macos.uploaded.urls).toEqual([
      "app:///bun/index.js",
      "app:///bun/index.js.map",
      "app:///chunk-a1b2c3.js",
      "app:///chunk-a1b2c3.js.map",
    ]);
    expect(linux.uploaded.urls).toEqual(macos.uploaded.urls);
    expect(linux.packagedMain).not.toBe(macos.packagedMain);
  } finally {
    sentry.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 120000);
