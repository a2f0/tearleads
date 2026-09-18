import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  windowsArtifactDigest,
  windowsReleaseNames,
} from "./windowsReleaseArtifacts";

for (const [tier, failure] of [
  ["staging", ""],
  ["production", ""],
  ["staging", "commit"],
  ["staging", "checksum"],
  ["staging", "sentry"],
]) {
  test(`${tier} Windows publication gate: ${failure || "success"}`, async () => {
    if (!tier) throw new Error("Missing test tier");
    const names = windowsReleaseNames(tier);
    const commit = "a".repeat(40);
    const { PATH: inheritedPath } = process.env;
    const root = await mkdtemp(join(tmpdir(), "publish-windows-"));
    const bin = join(root, "bin");
    const published = join(root, "published");
    const channel = tier === "staging" ? "canary" : "stable";
    const appName = tier === "staging" ? "Tearleads-canary" : "Tearleads";
    try {
      await mkdir(bin);
      await mkdir(published);
      await Bun.write(
        join(bin, "aws"),
        '#!/bin/sh\n[ -f "$PUBLISH_TEST_MAPS" ] || exit 9\nkey="$(basename "$4")"\nprintf "%s\\n" "$key" >> "$PUBLISH_TEST_LOG"\ncp "$3" "$PUBLISH_TEST_OUTPUT/$key"\n',
      );
      await chmod(join(bin, "aws"), 0o755);
      await Bun.write(join(root, names.installer), "windows installer");
      await Bun.write(join(root, names.archive), "windows update");
      await Bun.write(
        join(root, names.update),
        JSON.stringify({
          channel,
          platform: "win",
          arch: "x64",
          identifier: "com.tearleads.app",
        }),
      );
      const sha256 = Object.fromEntries(
        await Promise.all(
          [names.installer, names.archive, names.update].map(async (name) => [
            name,
            await windowsArtifactDigest(join(root, name)),
          ]),
        ),
      );
      await Bun.write(
        join(root, "release.json"),
        JSON.stringify({
          tier,
          commit: failure === "commit" ? "b".repeat(40) : commit,
          target: "win-x64",
          sha256,
        }),
      );
      if (failure === "checksum")
        await Bun.write(join(root, names.archive), "tampered");
      const entry = join(import.meta.dirname, "publishWindowsRelease.ts");
      await Bun.write(
        join(root, "publish.ts"),
        `import { publishWindowsRelease } from ${JSON.stringify(entry)};
await publishWindowsRelease({ artifacts: ${JSON.stringify(root)}, tier: ${JSON.stringify(tier)}, commit: ${JSON.stringify(commit)}, uploadSourceMaps: async () => {
  if (${JSON.stringify(failure)} === "sentry") throw new Error("Sentry upload failed");
  await Bun.write("sentry-complete", "uploaded");
} });`,
      );
      const child = Bun.spawn([process.execPath, join(root, "publish.ts")], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}:${inheritedPath}`,
          PUBLISH_TEST_MAPS: join(root, "sentry-complete"),
          PUBLISH_TEST_LOG: join(root, "uploads.log"),
          PUBLISH_TEST_OUTPUT: published,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, output] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      if (failure) {
        expect(code, output).not.toBe(0);
        expect(await readdir(published)).toEqual([]);
        expect(await Bun.file(join(root, "uploads.log")).exists()).toBe(false);
        expect(await Bun.file(join(root, "sentry-complete")).exists()).toBe(
          false,
        );
        expect(output).toContain(
          failure === "sentry"
            ? "Sentry upload failed"
            : failure === "commit"
              ? "provenance"
              : "checksum",
        );
        return;
      }
      expect(code, output).toBe(0);
      const prefix = `${channel}-win-x64`;
      const discovery = await Bun.file(
        join(published, `${prefix}-download.json`),
      ).json();
      expect(discovery.installer).toMatch(
        new RegExp(`^${prefix}-[a-f0-9]{64}-${appName}-Setup.zip$`),
      );
      expect(await Bun.file(join(published, discovery.installer)).text()).toBe(
        "windows installer",
      );
      expect(
        await Bun.file(join(published, discovery.checksum)).text(),
      ).toEndWith(`  ${discovery.installer}\n`);
      const update = await Bun.file(
        join(published, `${prefix}-update.json`),
      ).json();
      expect(await Bun.file(join(published, update.artifact.file)).text()).toBe(
        "windows update",
      );
      expect(
        (await Bun.file(join(root, "uploads.log")).text())
          .trim()
          .split("\n")
          .slice(-2),
      ).toEqual([`${prefix}-update.json`, `${prefix}-download.json`]);
      expect(await readdir(published)).toHaveLength(5);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
