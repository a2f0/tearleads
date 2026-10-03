import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { verificationFixture } from "./verification.testUtils";

test("package verification replaces stale SDK output before API, app, and SDK tests", () => {
  for (const name of ["@tearleads/api", "app", "@tearleads/client-sdk"]) {
    const repo = verificationFixture();
    try {
      const result = repo.run([
        "package",
        name,
        "--",
        "--test-name-pattern",
        "a pattern with spaces",
      ]);
      expect(result.code, result.output).toBe(0);
      expect(result.commands[0]).toEqual(["run", "build:packages"]);
      expect(result.commands[1]?.slice(-2)).toEqual([
        "--test-name-pattern",
        "a pattern with spaces",
      ]);
      const report = result.reports[0];
      expect(report?.status).toBe("passed");
      expect(report?.packageName).toBe(name);
      expect(report?.before.head).toBe(repo.head);
      expect(report?.before.status).toContain(
        "packages/client-sdk/src/version",
      );
      expect(report?.after?.fingerprint).toBe(report?.before.fingerprint);
      expect(report?.steps.map((step) => step.status)).toEqual([
        "passed",
        "passed",
      ]);
      expect(report?.finishedAt).not.toBeNull();
    } finally {
      repo.cleanup();
    }
  }
});

test("a failed prerequisite prevents tests and preserves its exit code and report", () => {
  for (const failed of ["build", "typescript", "static", "tests"]) {
    const repo = verificationFixture(failed);
    try {
      const result = repo.run(["full"]);
      expect(result.code, result.output).toBe(23);
      const report = result.reports[0];
      expect(report?.status).toBe("failed");
      expect(report?.exitCode).toBe(23);
      expect(report?.steps.find((step) => step.name === failed)?.status).toBe(
        "failed",
      );
      expect(report?.steps.find((step) => step.name === failed)?.exitCode).toBe(
        23,
      );
      const failedIndex =
        report?.steps.findIndex((step) => step.name === failed) ?? -1;
      expect(result.commands).toHaveLength(failedIndex + 1);
      for (const step of report?.steps.slice(failedIndex + 1) ?? []) {
        expect(step.status).toBe("skipped");
        expect(step.exitCode).toBeNull();
      }
    } finally {
      repo.cleanup();
    }
  }
});

test("full and affected checks retain the existing build, type, static, and test gates", () => {
  for (const mode of ["full", "affected"]) {
    const repo = verificationFixture();
    try {
      const result = repo.run([mode]);
      expect(result.code, result.output).toBe(0);
      expect(result.commands).toEqual([
        ["run", "build:packages"],
        ["tsc", "--build", "--pretty", "false"],
        ["run", "check:fast"],
        ["run", mode === "full" ? "test:turbo" : "test:turbo:affected"],
      ]);
      expect(
        result.reports[0]?.steps.every((step) => step.durationMs >= 0),
      ).toBe(true);
    } finally {
      repo.cleanup();
    }
  }
});

test("changed source contents fail verification even when Git status stays the same", () => {
  const repo = verificationFixture();
  try {
    const result = repo.run(["package", "app"], { CHANGE_SOURCE: "true" });
    expect(result.code, result.output).toBe(1);
    const report = result.reports[0];
    expect(report?.status).toBe("failed");
    expect(report?.before.status).toBe(report?.after?.status);
    expect(report?.before.fingerprint).not.toBe(report?.after?.fingerprint);
    expect(report?.error).toContain("changed during verification");
  } finally {
    repo.cleanup();
  }
});

test("a revision change fails verification and reports both commit IDs", () => {
  const repo = verificationFixture();
  try {
    const result = repo.run(["package", "app"], { CHANGE_HEAD: "true" });
    expect(result.code, result.output).toBe(1);
    const report = result.reports[0];
    expect(report?.before.head).toBe(repo.head);
    expect(report?.after?.head).not.toBe(repo.head);
    expect(report?.status).toBe("failed");
  } finally {
    repo.cleanup();
  }
});

test("untracked source changes are detected and clean runs remain clean", () => {
  const repo = verificationFixture();
  try {
    repo.git("add", "packages/client-sdk/src/version");
    repo.git("commit", "-qm", "update SDK");
    const clean = repo.run(["package", "app"]);
    expect(clean.code, clean.output).toBe(0);
    expect(clean.reports[0]?.before.status).toBe("");
    expect(clean.reports[0]?.after?.status).toBe("");
    repo.write("new-source.ts", "initial-untracked");
    const changed = repo.run(["package", "app"], { CHANGE_UNTRACKED: "true" });
    expect(changed.code, changed.output).toBe(1);
    const report = changed.reports.find((item) => item.status === "failed");
    expect(report?.before.status).toBe(report?.after?.status);
    expect(report?.before.fingerprint).not.toBe(report?.after?.fingerprint);
  } finally {
    repo.cleanup();
  }
});

test("an interrupted build leaves a failure report and never starts tests", async () => {
  const repo = verificationFixture();
  const child = repo.start(["package", "app"], { WAIT_IN_BUILD: "true" });
  try {
    const log = resolve(repo.cwd, ".git/commands.ndjson");
    const deadline = Date.now() + 5000;
    while (!existsSync(log) && Date.now() < deadline) await Bun.sleep(10);
    expect(existsSync(log)).toBe(true);
    const directory = resolve(repo.cwd, ".git/verification");
    const path = resolve(directory, readdirSync(directory)[0] ?? "missing");
    expect(JSON.parse(readFileSync(path, "utf8")).status).toBe("running");
    child.kill("SIGTERM");
    expect(await child.exited).toBe(143);
    const report = JSON.parse(readFileSync(path, "utf8"));
    expect(report.status).toBe("failed");
    expect(report.steps.map((step: { status: string }) => step.status)).toEqual(
      ["failed", "skipped"],
    );
    expect(readFileSync(log, "utf8").trim().split("\n")).toHaveLength(1);
  } finally {
    child.kill();
    repo.cleanup();
  }
});

test("invalid selections fail before running commands or writing reports", () => {
  for (const args of [
    ["package"],
    ["package", "missing"],
    ["package", "empty"],
    ["full", "extra"],
    ["unknown"],
  ]) {
    const repo = verificationFixture();
    try {
      const result = repo.run(args);
      expect(result.code).toBe(1);
      expect(result.commands).toEqual([]);
      expect(result.reports).toEqual([]);
    } finally {
      repo.cleanup();
    }
  }
});

test("root check commands use the verification runner", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(import.meta.dir, "../../../package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  const { check } = manifest.scripts;
  expect(check).toBe("bun scripts/testing/runVerification.ts full");
  expect(manifest.scripts["check:affected"]).toBe(
    "bun scripts/testing/runVerification.ts affected",
  );
  expect(manifest.scripts["check:package"]).toBe(
    "bun scripts/testing/runVerification.ts package",
  );
});
