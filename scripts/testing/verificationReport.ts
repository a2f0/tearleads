import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { VerificationPlan, VerificationStep } from "./verificationPlan";

export function verificationGit(root: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  }).trimEnd();
}

export function verificationSnapshot(root: string) {
  const status = verificationGit(
    root,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  );
  const hash = createHash("sha256").update(status);
  for (const args of [
    ["diff", "HEAD", "--binary", "--no-ext-diff", "--no-textconv"],
    ["diff", "--cached", "HEAD", "--binary", "--no-ext-diff", "--no-textconv"],
  ]) {
    hash.update(verificationGit(root, ...args));
  }
  const untracked = verificationGit(
    root,
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  );
  for (const path of untracked.split("\0").filter(Boolean)) {
    const absolute = join(root, path);
    hash.update(path).update("\0");
    hash.update(
      lstatSync(absolute).isSymbolicLink()
        ? readlinkSync(absolute)
        : readFileSync(absolute),
    );
    hash.update("\0");
  }
  return {
    head: verificationGit(root, "rev-parse", "HEAD"),
    tree: verificationGit(root, "rev-parse", "HEAD^{tree}"),
    status,
    fingerprint: hash.digest("hex"),
  };
}

type Snapshot = ReturnType<typeof verificationSnapshot>;

interface StepResult extends VerificationStep {
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  durationMs: number;
  exitCode: number | null;
  error?: string;
}

export interface VerificationReport {
  schemaVersion: 1;
  mode: VerificationPlan["mode"];
  packageName: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "passed" | "failed";
  exitCode: number | null;
  before: Snapshot;
  after: Snapshot | null;
  steps: StepResult[];
  error?: string;
}

export function verificationReportPath(root: string): string {
  const directory = resolve(
    root,
    verificationGit(root, "rev-parse", "--git-path", "verification"),
  );
  return join(directory, `${Date.now()}-${randomUUID()}.json`);
}

export function saveVerificationReport(
  path: string,
  report: VerificationReport,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(temporary, path);
}
