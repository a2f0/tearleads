import {
  appendFileSync,
  cpSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fixture } from "./softReset.testUtils";

export async function waitFor(check: () => boolean, milliseconds = 5000) {
  const deadline = performance.now() + milliseconds;
  while (!check()) {
    if (performance.now() >= deadline)
      throw new Error("cancel fixture deadline exceeded");
    await Bun.sleep(10);
  }
}

export function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Real Bash wrappers, but all secrets/backend setup and Terraform are isolated
// fakes. No inherited environment, real credentials, or provider calls.
export function cancelFixture(
  stack: "postgres" | "storage" | "edge" | "website" = "postgres",
  mode: "apply" | "plan" | "init" = "apply",
) {
  const f = fixture();
  const wrapper = `terraform/scripts/run-${stack}-stack.sh`;
  cpSync(join(import.meta.dir, "../..", wrapper), join(f.repo, wrapper));
  appendFileSync(
    join(f.repo, "terraform/scripts/common.sh"),
    "\nexport_tf_state_env() { :; }\n",
  );
  writeFileSync(
    join(f.root, "cancel-tool.ts"),
    `
import { appendFileSync, writeFileSync } from "node:fs";
const root = process.env.SOFT_RESET_FIXTURE;
const action = process.argv[3];
appendFileSync(root + "/terraform-calls", action + "\\n");
if (action !== ${JSON.stringify(mode)}) process.exit(0);
let signals = 0;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  appendFileSync(root + "/signals", signal + "\\n");
  if (++signals > 1) process.exit(75);
  setTimeout(() => {
    writeFileSync(root + "/state-written", "partial state flushed");
    process.exit(0);
  }, 1500);
});
writeFileSync(root + "/ready.json", JSON.stringify({ pid: process.pid, wrapperPid: process.ppid }));
setInterval(() => {}, 1000);
`,
  );
  writeFileSync(
    join(f.root, "bin/terraform"),
    `#!/bin/sh\nexec '${process.execPath}' '${f.root}/cancel-tool.ts' "$@"\n`,
    { mode: 0o755 },
  );
  for (const args of [
    ["add", "."],
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--quiet",
      "-m",
      "real wrappers",
    ],
  ]) {
    const result = Bun.spawnSync(["git", ...args], { cwd: f.repo, env: f.env });
    if (result.exitCode) throw new Error(result.stderr.toString());
  }
  writeFileSync(
    join(f.root, "driver.ts"),
    `
import { writeFileSync } from "node:fs";
import { ResetRun } from ${JSON.stringify(join(f.repo, "scripts/deploy/softResetRuntime.ts"))};
import { applyPlan, savedPlan } from ${JSON.stringify(join(f.repo, "scripts/deploy/softResetPlans.ts"))};
const run = new ResetRun(${JSON.stringify(f.repo)}, "prod");
const path = run.privateDir + "/saved.tfplan";
const bytes = Buffer.from("inspected fixture bytes");
writeFileSync(path, bytes);
let success = false;
try {
  await run.step("apply", () => ${stack === "edge" || stack === "website" ? `run.exec([${JSON.stringify(wrapper)}, "prod", "output", "-json"], "terraform-state")` : mode === "plan" ? `savedPlan(run, { account: "fixture", organization: "fixture", domain: "example.test" }, ${JSON.stringify(stack)}, "no-op")` : `applyPlan(run, ${JSON.stringify(stack)}, { path, bytes, json: {} })`});
  await run.exec([${JSON.stringify(process.execPath)}, "-e", "require('node:fs').writeFileSync('later-step', '')"], "bounded-command");
  success = true;
} catch (error) { console.error(String(error)); }
process.exitCode = await run.finish(success);
`,
  );
  const child = Bun.spawn([process.execPath, join(f.root, "driver.ts")], {
    cwd: f.repo,
    env: f.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  return {
    ...f,
    child,
    stdout,
    stderr,
    ready: () =>
      JSON.parse(readFileSync(join(f.root, "ready.json"), "utf8")) as {
        pid: number;
        wrapperPid: number;
      },
    async cleanup() {
      child.kill("SIGKILL");
      if (existsSync(join(f.root, "ready.json"))) {
        const { pid, wrapperPid } = this.ready();
        for (const target of [-wrapperPid, pid]) {
          try {
            process.kill(target, "SIGKILL");
          } catch {
            /* already gone */
          }
        }
        await waitFor(() => !alive(pid));
      }
      await child.exited;
      await Promise.all([stdout, stderr]);
      rmSync(f.root, { recursive: true, force: true });
    },
  };
}
