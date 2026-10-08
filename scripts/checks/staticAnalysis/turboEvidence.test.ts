import { expect, test } from "bun:test";
import {
  assertCompletedTurboRun,
  plannedTurboTasks,
} from "../../testing/turboRunEvidence";
import { completedTurboFixture, turboFixture } from "./turboEvidence.testUtils";

function completeSummary() {
  return {
    version: "1",
    execution: {
      attempted: 2,
      success: 1,
      cached: 1,
      failed: 0,
      exitCode: 0,
      startTime: 100,
      endTime: 200,
    },
    tasks: [
      { taskId: "a#test", execution: { exitCode: 0 } },
      { taskId: "b#build", execution: { exitCode: 0 } },
    ],
  };
}

test("planned tasks omit graph placeholders and successful completion includes cache hits", () => {
  const planned = plannedTurboTasks({
    tasks: [
      { taskId: "a#test", command: "bun test" },
      { taskId: "b#build", command: "build" },
      { taskId: "c#build", command: "<NONEXISTENT>" },
    ],
  });
  expect([...planned]).toEqual(["a#test", "b#build"]);
  expect(() =>
    assertCompletedTurboRun({
      summary: completeSummary(),
      planned,
      startedAt: 100,
    }),
  ).not.toThrow();
});

test.each([
  "interrupted",
  "unattempted",
  "missing",
  "duplicate",
  "failed",
  "stale",
])("zero process exit cannot admit %s completion evidence", (mode) => {
  const summary = completeSummary();
  if (mode === "interrupted") {
    summary.execution.success = 0;
    summary.tasks.pop();
  }
  if (mode === "unattempted") {
    summary.execution.attempted = 0;
    summary.execution.success = 0;
    summary.execution.cached = 0;
    summary.tasks = [];
  }
  if (mode === "missing") summary.tasks.pop();
  if (mode === "duplicate")
    summary.tasks[1] = { taskId: "a#test", execution: { exitCode: 0 } };
  if (mode === "failed")
    summary.tasks[1] = { taskId: "b#build", execution: { exitCode: 1 } };
  if (mode === "stale") summary.execution.startTime = 99;
  expect(() =>
    assertCompletedTurboRun({
      summary,
      planned: new Set(["a#test", "b#build"]),
      startedAt: 100,
    }),
  ).toThrow();
});

test("the real Turbo runner admits fresh, cached and empty successful plans", async () => {
  const f = turboFixture();
  try {
    for (const args of [
      ["test"],
      ["test"],
      ["e2e"],
      ["test", "--filter=!//"],
    ]) {
      const result = await completedTurboFixture(f.start(args));
      expect(result.output).not.toContain("[turbo-verification]");
      expect(result.code).toBe(0);
      if (args.includes("--filter=!//"))
        expect(result.output).toContain("0 successful, 0 total");
    }
  } finally {
    f.close();
  }
}, 20_000);

test("a real task failure remains a failed verification", async () => {
  const f = turboFixture("fail");
  try {
    expect((await completedTurboFixture(f.start())).code).not.toBe(0);
  } finally {
    f.close();
  }
}, 20_000);

test("task arguments after the separator reach the task unchanged", async () => {
  const f = turboFixture();
  try {
    const result = await completedTurboFixture(
      f.start(["test", "--", "--ui", "fixture-argument"]),
    );
    expect(result.code).toBe(0);
    expect(result.output).toContain('["--ui","fixture-argument"]');
  } finally {
    f.close();
  }
}, 20_000);

test.skipIf(process.platform === "win32")(
  "an interrupted Turbo binary returning zero cannot pass verification",
  async () => {
    const f = turboFixture("slow");
    const child = f.start();
    const finished = completedTurboFixture(child);
    let binaryPid: number | undefined;
    try {
      binaryPid = Number(await f.waitFor("turbo-pid"));
      await f.waitFor("started");
      process.kill(binaryPid, "SIGINT");
      const result = await finished;
      expect(result.output).toContain("0 successful, 1 total");
      expect(result.code).not.toBe(0);
      expect(result.output).toContain("[turbo-verification]");
    } finally {
      if (child.exitCode === null) {
        if (binaryPid) process.kill(binaryPid, "SIGTERM");
        child.kill();
        await finished;
      }
      f.close();
    }
  },
  20_000,
);
