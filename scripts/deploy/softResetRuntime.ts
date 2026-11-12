import { spawn } from "node:child_process";
import {
  closeSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { constants, homedir } from "node:os";
import { basename, join } from "node:path";
import { superviseCommand } from "./softResetProcess";
import type { InterruptPolicy } from "./softResetProcessState";

type Status = "running" | "succeeded" | "failed" | "interrupted";
interface Step {
  label: string;
  status: Status;
  elapsedMs: number;
}

export function refuseOverrides(run: Pick<ResetRun, "root" | "tier">) {
  for (const stack of ["postgres", "storage"]) {
    const dir = join(run.root, "terraform/stacks", run.tier, stack);
    if (
      readdirSync(dir).some((name) =>
        /(^override|_override)\.tf(\.json)?$/.test(name),
      )
    ) {
      throw new Error(
        `Foreign ${stack} override exists; identify its owner before recovery.`,
      );
    }
  }
}

// One sequential owner writes the append-only timing record. Cancellation is
// independent of progress; no resume/retry state or rollback is implied.
export class ResetRun {
  readonly dir: string;
  readonly privateDir: string;
  readonly env: NodeJS.ProcessEnv;
  private readonly lock: string;
  private readonly lockIdentity;
  private readonly started = performance.now();
  private readonly steps: Step[] = [];
  private readonly signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  private interrupted: NodeJS.Signals | undefined;
  private interruptChild: (() => void) | undefined;
  private sequence = 0;
  private sha = "";
  private status: Status = "running";

  constructor(
    readonly root: string,
    readonly tier: "prod" | "staging",
  ) {
    process.umask(0o077);
    const base = join(homedir(), ".local/state/tearleads-soft-reset");
    mkdirSync(base, { recursive: true, mode: 0o700 });
    const info = lstatSync(base);
    if (
      !info.isDirectory() ||
      info.uid !== process.getuid?.() ||
      info.mode & 0o077
    ) {
      throw new Error(
        "Operational record directory must be an owned private directory.",
      );
    }
    this.lock = join(base, `${tier}.lock`);
    try {
      mkdirSync(this.lock, { mode: 0o700 });
    } catch {
      throw new Error(
        `Reset lock exists: ${this.lock}. Investigate the owning run; never blindly rerun.`,
      );
    }
    this.lockIdentity = lstatSync(this.lock);
    this.dir = mkdtempSync(join(base, "run-"));
    this.privateDir = join(this.dir, "private");
    mkdirSync(this.privateDir, { mode: 0o700 });
    writeFileSync(
      join(this.lock, "owner.json"),
      JSON.stringify({ pid: process.pid, root, tier, run: this.dir }),
      { mode: 0o600 },
    );
    // Eliminate development connection fallbacks and Terraform argument injection.
    this.env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !/^(GIT_|TF_CLI_ARGS|TF_WORKSPACE$|TF_DATA_DIR$|DATABASE_URL$|POSTGRES_URL$|PG|AWS_(PROFILE|DEFAULT_PROFILE|SESSION_TOKEN|SECURITY_TOKEN)$|TEARLEADS_TEARDOWN_TIER$|BASH_ENV$|ENV$|SHELLOPTS$)/.test(
            key,
          ),
      ),
    );
    Object.assign(this.env, {
      TMPDIR: this.privateDir,
      TF_IN_AUTOMATION: "1",
    });
    for (const signal of this.signals) process.on(signal, this.interrupt);
    this.persist();
    console.log(`Private run record: ${this.dir}`);
  }

  private interrupt = (signal: NodeJS.Signals) => {
    this.interrupted ??= signal;
    this.interruptChild?.();
  };

  async exec(
    args: string[],
    interruptPolicy: InterruptPolicy,
    extraEnv: NodeJS.ProcessEnv = {},
    cwd = this.root,
  ): Promise<string> {
    if (this.interrupted)
      throw new Error("Interrupted; manual recovery required.");
    const prefix = join(this.privateDir, `command-${++this.sequence}`);
    writeFileSync(
      `${prefix}.json`,
      JSON.stringify({ args, cwd, interruptPolicy }),
      {
        mode: 0o600,
      },
    );
    const out = openSync(`${prefix}.out`, "wx", 0o600);
    const err = openSync(`${prefix}.err`, "wx", 0o600);
    try {
      const child = spawn(args[0] ?? "", args.slice(1), {
        cwd,
        env: { ...this.env, ...extraEnv },
        detached: true,
        stdio: ["ignore", out, err],
      });
      const command = superviseCommand(child, interruptPolicy);
      this.interruptChild = command.interrupt;
      if (this.interrupted) command.interrupt();
      let code: number | null;
      try {
        code = await command.completed;
        await new Promise<void>((resolve) => setImmediate(resolve));
      } finally {
        this.interruptChild = undefined;
      }
      if (this.interrupted)
        throw new Error("Interrupted; manual recovery required.");
      if (code !== 0)
        throw new Error(
          `${basename(args[0] ?? "")} failed; inspect private command-${this.sequence} logs.`,
        );
      return readFileSync(`${prefix}.out`, "utf8").trim();
    } finally {
      closeSync(out);
      closeSync(err);
    }
  }

  async source() {
    this.requireLock();
    const sha = await this.exec(
      ["git", "rev-parse", "HEAD"],
      "bounded-command",
    );
    const dirty = await this.exec(
      ["git", "status", "--porcelain", "--untracked-files=all"],
      "bounded-command",
    );
    const root = await this.exec(
      ["git", "rev-parse", "--show-toplevel"],
      "bounded-command",
    );
    if (
      !/^[a-f0-9]{40}$/.test(sha) ||
      dirty ||
      root !== this.root ||
      (this.sha && this.sha !== sha)
    ) {
      throw new Error(
        "Source must remain clean at the pinned commit throughout the reset.",
      );
    }
    this.sha = sha;
    refuseOverrides(this);
  }

  async step<T>(label: string, effect: () => Promise<T>): Promise<T> {
    const step: Step = { label, status: "running", elapsedMs: 0 };
    const start = performance.now();
    this.steps.push(step);
    this.persist();
    console.log(`--- ${label} ---`);
    try {
      await this.source();
      const result = await effect();
      await this.source();
      step.status = "succeeded";
      return result;
    } catch (error) {
      step.status = this.interrupted ? "interrupted" : "failed";
      throw error;
    } finally {
      step.elapsedMs = Math.round(performance.now() - start);
      this.persist();
      console.log(`${label}: ${step.status} (${step.elapsedMs}ms)`);
    }
  }

  private persist() {
    writeFileSync(
      join(this.dir, "timings.next.json"),
      JSON.stringify(
        {
          status: this.status,
          tier: this.tier,
          source: this.sha,
          pid: process.pid,
          steps: this.steps,
          elapsedMs: Math.round(performance.now() - this.started),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    renameSync(
      join(this.dir, "timings.next.json"),
      join(this.dir, "timings.json"),
    );
  }

  private requireLock() {
    const lock = lstatSync(this.lock, { throwIfNoEntry: false });
    if (
      lock?.ino !== this.lockIdentity.ino ||
      lock?.dev !== this.lockIdentity.dev
    ) {
      throw new Error(
        "Active reset lock ownership changed; stop and investigate.",
      );
    }
  }

  private cleanup() {
    const started = performance.now();
    const step: Step = { label: "cleanup", status: "running", elapsedMs: 0 };
    this.steps.push(step);
    try {
      this.requireLock();
      rmSync(this.privateDir, { recursive: true });
      this.requireLock();
      rmSync(this.lock, { recursive: true });
      step.status = "succeeded";
      return true;
    } catch {
      step.status = "failed";
      console.error(
        "Cleanup failed; inspect the remaining private record and lock ownership.",
      );
      return false;
    } finally {
      step.elapsedMs = Math.round(performance.now() - started);
    }
  }

  async finish(success: boolean) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (success && !this.interrupted) success = this.cleanup();
    this.status = this.interrupted
      ? "interrupted"
      : success
        ? "succeeded"
        : "failed";
    this.persist();
    for (const signal of this.signals) process.off(signal, this.interrupt);
    console.log(`--- Timing summary: ${this.status} ---`);
    for (const step of this.steps)
      console.log(`${step.label}\t${step.status}\t${step.elapsedMs}ms`);
    console.log(
      `total\t${this.status}\t${Math.round(performance.now() - this.started)}ms`,
    );
    if (this.status !== "succeeded") {
      console.error(
        `Stopped at ${this.steps.at(-1)?.label ?? "startup"}. Maintenance or a partial rebuild may remain. No rollback occurred.\nPreserved lock: ${this.lock}\nRead ${this.dir}/timings.json and docs/developer/greenfield-reset.md before manual recovery; do not rerun the reset.`,
      );
    }
    return this.status === "succeeded"
      ? 0
      : this.interrupted
        ? 128 + constants.signals[this.interrupted]
        : 1;
  }
}
