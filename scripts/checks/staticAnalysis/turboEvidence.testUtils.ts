import {
  chmodSync,
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve } from "node:path";
import { fixture } from "./fixture.testUtils";

const runner = resolve(import.meta.dir, "../../testing/runVerifiedTurbo.ts");
const turboRequire = createRequire(
  realpathSync(resolve(import.meta.dir, "../../../node_modules/.bin/turbo")),
);
const platform = process.platform === "win32" ? "windows" : process.platform;
const arch = process.arch === "x64" ? "64" : process.arch;
const binary = turboRequire.resolve(
  `@turbo/${platform}-${arch}/bin/turbo${process.platform === "win32" ? ".exe" : ""}`,
);

export function turboFixture(mode: "pass" | "fail" | "slow" = "pass") {
  const repo = fixture();
  repo.write(".gitignore", ".turbo/\nnode_modules/\nstarted\nturbo-pid\n");
  repo.write(
    "package.json",
    JSON.stringify({
      name: "turbo-evidence-fixture",
      private: true,
      packageManager: `bun@${Bun.version}`,
      scripts: { test: "bun task.ts" },
    }),
  );
  repo.write(
    "turbo.json",
    JSON.stringify({
      tasks: { test: { dependsOn: ["build"] }, build: {}, e2e: {} },
    }),
  );
  repo.write(
    "task.ts",
    mode === "slow"
      ? 'await Bun.write("started", "yes"); await Bun.sleep(30000);\n'
      : mode === "fail"
        ? "process.exit(17);\n"
        : 'console.log("fixture complete");\n',
  );
  repo.write(
    "node_modules/.bin/turbo",
    `#!${process.execPath}
const args = process.argv.slice(2);
const child = Bun.spawn([${JSON.stringify(binary)}, ...args], { stdout: "inherit", stderr: "inherit", stdin: "inherit" });
if (!args.includes("--dry-run=json")) await Bun.write("turbo-pid", String(child.pid));
process.exitCode = await child.exited;
`,
  );
  chmodSync(join(repo.cwd, "node_modules/.bin/turbo"), 0o755);
  const env = {
    ...repo.env,
    PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`,
    TURBO_TELEMETRY_DISABLED: "1",
  };
  const install = Bun.spawnSync(
    [process.execPath, "install", "--ignore-scripts"],
    { cwd: repo.cwd, env, stdout: "pipe", stderr: "pipe" },
  );
  if (install.exitCode !== 0) throw new Error(install.stderr.toString());
  repo.commit();
  const start = (args = ["test"]) =>
    Bun.spawn([process.execPath, runner, ...args], {
      cwd: repo.cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
  const waitFor = async (name: string) => {
    const deadline = Date.now() + 8000;
    while (!existsSync(join(repo.cwd, name))) {
      if (Date.now() >= deadline)
        throw new Error(`Fixture did not create ${name}`);
      await Bun.sleep(10);
    }
    return readFileSync(join(repo.cwd, name), "utf8");
  };
  return {
    ...repo,
    start,
    waitFor,
    close: () => rmSync(repo.cwd, { recursive: true, force: true }),
  };
}

export async function completedTurboFixture(
  child: ReturnType<ReturnType<typeof turboFixture>["start"]>,
) {
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, output: stdout + stderr };
}
