import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const tier of ["staging", "production"]) {
  test(`${tier} Windows publication uploads immutable files before discovery`, async () => {
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
        '#!/bin/sh\nkey="$(basename "$4")"\nprintf "%s\\n" "$key" >> "$PUBLISH_TEST_LOG"\ncp "$3" "$PUBLISH_TEST_OUTPUT/$key"\n',
      );
      await chmod(join(bin, "aws"), 0o755);
      await Bun.write(join(root, "installer.zip"), "windows installer");
      await Bun.write(join(root, "archive.zst"), "windows update");
      await Bun.write(
        join(root, "update.json"),
        JSON.stringify({ channel, platform: "win", arch: "x64" }),
      );
      const entry = join(import.meta.dirname, "publishDesktopRelease.ts");
      await Bun.write(
        join(root, "publish.ts"),
        `import { publishDesktopRelease } from ${JSON.stringify(entry)};
await publishDesktopRelease({ bucket: "fixture", channel: ${JSON.stringify(channel)}, appName: ${JSON.stringify(appName)}, target: "win-x64", installer: "installer.zip", archive: "archive.zst", update: "update.json" });`,
      );
      const child = Bun.spawn([process.execPath, join(root, "publish.ts")], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}:${inheritedPath}`,
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
