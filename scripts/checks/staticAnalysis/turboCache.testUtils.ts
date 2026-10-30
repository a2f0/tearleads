import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixture } from "./fixture.testUtils";

const root = resolve(import.meta.dir, "../../..");

export function cacheFixture() {
  const repo = fixture();
  const copy = (path: string) =>
    repo.write(path, readFileSync(join(root, path), "utf8"));
  for (const path of ["package.json", "bun.lock", "turbo.json"]) copy(path);
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const workspace of manifest.workspaces as string[]) {
    copy(`${workspace}/package.json`);
    if (existsSync(join(root, workspace, "turbo.json")))
      copy(`${workspace}/turbo.json`);
  }
  repo.write(".gitignore", "node_modules/\n.turbo/\n.screenshots\n");
  repo.commit();

  const hashes = (env: Record<string, string> = {}) => {
    const result = Bun.spawnSync(
      [
        join(root, "node_modules/.bin/turbo"),
        "run",
        "test",
        "test:postgres-concurrency",
        "test:windows-ci",
        "test:native-android-ci",
        "test:native-ios-ci",
        "check:protocol-models",
        "check:protocol-negative-controls",
        "--dry-run=json",
        // Dry runs probe cache availability; fixtures only need task hashes.
        "--cache=local:rw",
      ],
      {
        cwd: repo.cwd,
        env: { ...repo.env, TURBO_TELEMETRY_DISABLED: "1", ...env },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    const { tasks } = JSON.parse(result.stdout.toString()) as {
      tasks: { taskId: string; hash: string; command: string }[];
    };
    return Object.fromEntries(
      tasks
        .filter(({ command }) => command !== "<NONEXISTENT>")
        .map(({ taskId, hash }) => [taskId, hash]),
    );
  };
  const baseline = hashes();
  const changed = (env?: Record<string, string>) =>
    Object.entries(hashes(env))
      .filter(([id, hash]) => baseline[id] !== hash)
      .map(([id]) => id)
      .sort();
  return {
    ...repo,
    changed,
    close: () => rmSync(repo.cwd, { recursive: true, force: true }),
  };
}
