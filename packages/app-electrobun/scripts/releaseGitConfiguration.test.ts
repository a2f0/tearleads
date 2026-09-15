import { expect, test } from "bun:test";
import { chmod, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import {
  createReleaseCheckouts,
  type ReleaseCheckouts,
  removeReleaseCheckouts,
  runRelease,
} from "./releaseCheckout.testUtils";

const sourceModule = join(import.meta.dirname, "sentryReleaseSource.ts");

async function runSourceCheck({ root, checkout }: ReleaseCheckouts) {
  const log = join(root, "source-check.log");
  const child = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      "--config=/dev/null",
      "-e",
      `import { desktopSentryCommit } from ${JSON.stringify(sourceModule)};
       console.log(desktopSentryCommit(${JSON.stringify(checkout)}));`,
    ],
    {
      cwd: root,
      env: { ...process.env, HOME: root, RELEASE_TEST_LOG: log },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  return {
    exitCode,
    stderr,
    steps: (await Bun.file(log).exists()) ? [await Bun.file(log).text()] : [],
  };
}

const entries = ["releaseMacos.sh", "releaseLinux.sh", "source check"] as const;
for (const entry of entries) {
  for (const attack of ["excludesFile", "fsmonitor"] as const) {
    test(`${entry} ignores host ${attack} configuration while checking sources`, async () => {
      const fixture = await createReleaseCheckouts(true);
      try {
        const monitor = join(fixture.root, "fsmonitor");
        await Bun.write(
          monitor,
          '#!/bin/sh\necho monitor-ran >> "$RELEASE_TEST_LOG"\nprintf "token\\0"\n',
        );
        await chmod(monitor, 0o755);
        const value =
          attack === "excludesFile"
            ? join(fixture.root, "ignore-all")
            : monitor;
        await Bun.write(
          join(fixture.root, ".gitconfig"),
          `[core]\n${attack} = ${value}\n`,
        );
        const run = () =>
          entry === "source check"
            ? runSourceCheck(fixture)
            : runRelease(
                fixture,
                [
                  "bash",
                  join(
                    fixture.checkout,
                    "packages/app-electrobun/scripts",
                    entry,
                  ),
                  "upload",
                  "production",
                ],
                {},
              );
        const dirty = await run();
        expect(dirty.exitCode, dirty.stderr).toBe(1);
        expect(dirty.stderr).toContain("clean Git checkout");
        expect(dirty.steps).toEqual([]);

        // A clean checkout still works with the same host configuration.
        await rm(join(fixture.checkout, "bunfig.toml"));
        const clean = await run();
        expect(clean.exitCode, clean.stderr).toBe(
          entry === "source check" ? 0 : 3,
        );
        expect(clean.steps.join("\n")).not.toContain("monitor-ran");
      } finally {
        await removeReleaseCheckouts(fixture);
      }
    });
  }
}

for (const driver of ["releaseMacos.sh", "releaseLinux.sh"]) {
  test(`${driver} follows relative link chains and directory links to its own checkout`, async () => {
    const fixture = await createReleaseCheckouts(true);
    try {
      const alias = join(fixture.root, "alias");
      await symlink("checkout", alias);
      const first = join(fixture.decoy, "first");
      await symlink(
        `../alias/packages/app-electrobun/scripts/${driver}`,
        first,
      );
      const second = join(fixture.decoy, "second");
      await symlink("first", second);
      const result = await runRelease(
        fixture,
        ["bash", second, "upload", "production"],
        {},
      );
      expect(result.exitCode, result.stderr).toBe(1);
      expect(result.stderr).toContain("clean Git checkout");
      expect(result.steps).toEqual([]);
    } finally {
      await removeReleaseCheckouts(fixture);
    }
  });
}
