import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("the Sentry release wrapper starts without dotenv files or BUN_OPTIONS", async () => {
  const root = await mkdtemp(join(tmpdir(), "build-electrobun-"));
  try {
    const script = join(root, "packages/app-electrobun/scripts/build.sh");
    await Bun.write(
      script,
      Bun.file(join(import.meta.dirname, "buildElectrobun.sh")),
    );
    await Bun.write(join(root, "scripts/withBuildInfoEnv.sh"), 'exec "$@"\n');
    const log = join(root, "bun.log");
    await Bun.write(
      join(root, "bin/bun"),
      `#!/bin/sh\nprintf '%s|%s|%s\\n' "\${BUN_OPTIONS-unset}" "$NODE_ENV" "$*" >> '${log}'\n`,
    );
    await chmod(join(root, "bin/bun"), 0o755);
    const build = Bun.spawnSync(["sh", script, "--env=canary"], {
      env: {
        PATH: `${join(root, "bin")}:/usr/bin:/bin`,
        BUN_OPTIONS: `--env-file=${join(root, "hostile.env")}`,
      },
      stderr: "pipe",
    });
    expect(build.exitCode, build.stderr.toString()).toBe(0);
    expect(await Bun.file(log).text()).toBe(
      "unset|production|--no-env-file scripts/withSentryReleaseEnv.ts bun --bun run electrobun build --env=canary\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
