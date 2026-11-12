import { expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fixture } from "./softReset.testUtils";

test("screenshot/build readiness failure explains recovery before downtime", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "fail-website"), "");
    const result = f.run();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("take-screenshots");
    expect(f.records().record.steps.at(-1).label).toBe("website-readiness");
    expect(
      f.calls().some((call) => call[0] === "deployApiMaintenance.sh"),
    ).toBe(false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}, 30_000);

test("replacement override is preserved and detected before downtime", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "replace-override"), "");
    const result = f.run();
    expect(result.exitCode).toBe(1);
    expect(
      readFileSync(
        join(f.repo, "terraform/stacks/prod/storage/soft_reset_override.tf"),
        "utf8",
      ),
    ).toBe("foreign replacement");
    expect(
      f.calls().some((call) => call[0] === "deployApiMaintenance.sh"),
    ).toBe(false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}, 30_000);

test("a replaced active lock stops the owner without removing the replacement", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "replace-lock"), "");
    const result = f.run();
    expect(result.exitCode).toBe(1);
    expect(
      readFileSync(
        join(f.home, ".local/state/tearleads-soft-reset/prod.lock/owner.json"),
        "utf8",
      ),
    ).toBe("foreign owner");
    expect(f.records().record.steps.at(-1).label).toBe("maintenance");
    expect(f.calls().some((call) => call[0] === "drop-postgres-owned.sh")).toBe(
      false,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}, 30_000);

test("source changes during maintenance stop before any data deletion", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "dirty-during-maintenance"), "");
    const result = f.run();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("pinned commit");
    expect(f.records().record.steps.at(-1).label).toBe("maintenance");
    expect(f.calls().some((call) => call[0] === "drop-postgres-owned.sh")).toBe(
      false,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}, 30_000);

async function waitFor(check: () => boolean, milliseconds: number) {
  const deadline = performance.now() + milliseconds;
  while (!check()) {
    if (performance.now() >= deadline)
      throw new Error("fixture deadline exceeded");
    await Bun.sleep(25);
  }
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("SIGTERM stops own uncooperative process group and retains interrupted timing", async () => {
  const f = fixture();
  writeFileSync(join(f.root, "block-maintenance"), "");
  const child = Bun.spawn(f.command, {
    cwd: f.repo,
    env: f.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  let pids: number[] = [];
  try {
    await waitFor(() => existsSync(join(f.root, "child-pids.json")), 15_000);
    pids = JSON.parse(readFileSync(join(f.root, "child-pids.json"), "utf8"));
    const clone = join(f.root, "second-clone");
    cpSync(f.repo, clone, { recursive: true });
    const contender = Bun.spawnSync(
      [
        process.execPath,
        join(clone, "scripts/deploy/softReset.ts"),
        ...f.command.slice(2),
      ],
      { cwd: clone, env: f.env },
    );
    expect(contender.exitCode).toBe(1);
    expect(contender.stderr.toString()).toContain("lock exists");
    expect(pids.every(alive)).toBe(true);
    child.kill("SIGTERM");
    expect(
      await Promise.race([
        child.exited,
        Bun.sleep(3000).then(() => {
          throw new Error(
            "reset did not terminate its child group within cleanup budget",
          );
        }),
      ]),
    ).toBe(130);
    await waitFor(() => pids.every((pid) => !alive(pid)), 3000);
    expect(f.records().record.status).toBe("interrupted");
    expect(f.records().record.steps.at(-1)).toMatchObject({
      label: "maintenance",
      status: "interrupted",
    });
    expect(await stdout).toContain("total\tinterrupted");
    expect(await stderr).toContain("do not rerun");
    expect(f.calls().some((call) => call[0] === "drop-postgres-owned.sh")).toBe(
      false,
    );
  } finally {
    child.kill("SIGKILL");
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    rmSync(f.root, { recursive: true, force: true });
  }
}, 25_000);
