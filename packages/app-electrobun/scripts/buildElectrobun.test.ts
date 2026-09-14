import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bunLaunchVariables = [
  "BUN_OPTIONS",
  "BUN_INSPECT",
  "BUN_INSPECT_CONNECT_TO",
  "BUN_INSPECT_NOTIFY",
  "BUN_INSPECT_PRELOAD",
];

// A checkout holding this build script and the real build-info wrapper, whose
// PATH is the returned bin directory followed by the system's.
async function withLauncher(
  run: (paths: {
    root: string;
    packageDir: string;
    script: string;
    bin: string;
  }) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "build-electrobun-"));
  try {
    const packageDir = join(root, "packages/app-electrobun");
    const script = join(packageDir, "scripts/build.sh");
    await Bun.write(
      script,
      Bun.file(join(import.meta.dirname, "buildElectrobun.sh")),
    );
    await Bun.write(
      join(root, "scripts/withBuildInfoEnv.sh"),
      Bun.file(
        join(import.meta.dirname, "../../../scripts/withBuildInfoEnv.sh"),
      ),
    );
    await Bun.write(join(packageDir, "package.json"), '{"version":"1.2.3"}\n');
    await run({ root, packageDir, script, bin: join(root, "bin") });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("every Bun process up to the Sentry release wrapper starts without dotenv files, bunfig.toml or Bun launch variables", async () => {
  await withLauncher(async ({ root, script, bin }) => {
    const log = join(root, "bun.log");
    const seen = bunLaunchVariables
      .map((name) => `${name}=\${${name}-unset}`)
      .join(" ");
    await Bun.write(
      join(bin, "bun"),
      `#!/bin/sh\nprintf '%s|%s|%s\\n' "${seen}" "$NODE_ENV" "$*" >> '${log}'\n`,
    );
    await chmod(join(bin, "bun"), 0o755);
    const build = Bun.spawnSync(["sh", script, "--env=canary"], {
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        ...Object.fromEntries(
          bunLaunchVariables.map((name) => [name, join(root, "hostile")]),
        ),
      },
      stderr: "pipe",
    });
    expect(build.exitCode, build.stderr.toString()).toBe(0);
    const unset = bunLaunchVariables.map((name) => `${name}=unset`).join(" ");
    const [version, wrapper, ...rest] = (await Bun.file(log).text())
      .trimEnd()
      .split("\n");
    expect(version).toStartWith(
      `${unset}|production|--no-env-file --config=/dev/null -e `,
    );
    expect(wrapper).toBe(
      `${unset}|production|--no-env-file --config=/dev/null scripts/withSentryReleaseEnv.ts bun --bun run electrobun build --env=canary`,
    );
    expect(rest).toEqual([]);
  });
});

test.each(["BUN_OPTIONS", "BUN_INSPECT_PRELOAD", "bunfig.toml"])(
  "no %s preload runs in a real Bun process before the Sentry release wrapper",
  async (source) => {
    await withLauncher(async ({ root, packageDir, script, bin }) => {
      const log = join(root, "launch.log");
      const preload = join(root, "preload.ts");
      await Bun.write(
        preload,
        `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(log)}, "preload\\n");\n`,
      );
      if (source === "bunfig.toml")
        await Bun.write(
          join(packageDir, "bunfig.toml"),
          `preload = [${JSON.stringify(preload)}]\n`,
        );
      await Bun.write(
        join(packageDir, "scripts/withSentryReleaseEnv.ts"),
        `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(log)}, \`wrapper \${process.env.BUN_PUBLIC_APP_VERSION}\\n\`);\n`,
      );
      await mkdir(bin);
      await symlink(process.execPath, join(bin, "bun"));
      const hostile = {
        BUN_OPTIONS: { BUN_OPTIONS: `--preload=${preload}` },
        BUN_INSPECT_PRELOAD: { BUN_INSPECT_PRELOAD: preload },
        "bunfig.toml": {},
      }[source];
      const build = Bun.spawnSync(["sh", script], {
        env: { HOME: root, PATH: `${bin}:/usr/bin:/bin`, ...hostile },
        stderr: "pipe",
      });
      expect(build.exitCode, build.stderr.toString()).toBe(0);
      expect(await Bun.file(log).text()).toBe("wrapper 1.2.3\n");
    });
  },
);
