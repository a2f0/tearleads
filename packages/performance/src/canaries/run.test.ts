import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseCanaryOutput } from "./output";
import { logTail, runCanary, runStatus } from "./run";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const metrics = JSON.stringify({
  label: "fake phase",
  total: 1,
  bodyBytes: { request: 3, response: 4 },
  syncIntents: { readOnly: 0, writeBearing: 0 },
  byRequest: {
    "GET /x": { count: 1, bodyBytes: { request: 3, response: 4 } },
  },
});

async function fakeApp(body: string) {
  const root = await mkdtemp(resolve(tmpdir(), "canary-run-"));
  directories.push(root);
  await mkdir(resolve(root, "src"));
  await writeFile(
    resolve(root, "src/Fake.test.ts"),
    `import { expect, test } from "bun:test";\n${body}`,
  );
  return root;
}

test("runs one file with the profile on and keeps its output", async () => {
  const root = await fakeApp(`
test("profiles", () => {
  if (process.env.DUAL_PANE_REQUEST_PROFILE === "1" &&
      process.env.DUAL_PANE_REQUEST_PROFILE_DETAIL === "1")
    console.info(${JSON.stringify(`[dual-pane-request-metrics] ${metrics}`)});
  expect(1).toBe(1);
});`);
  const log = resolve(root, "fake.log");
  const run = await runCanary({
    canary: { name: "Fake", file: "src/Fake.test.ts" },
    sample: 2,
    log,
    root,
  });
  expect(run).toMatchObject({
    canary: "Fake",
    file: "src/Fake.test.ts",
    sample: 2,
    status: "passed",
    exitCode: 0,
    tests: { pass: 1, fail: 0 },
    log,
  });
  expect(run.phases.map((phase) => phase.label)).toEqual(["fake phase"]);
  expect((await stat(log)).mode & 0o777).toBe(0o600);
  const tail = await logTail(log, 4);
  expect(tail).toContain(" 1 pass");
  expect(tail).not.toContain("dual-pane-request-metrics");
});

test("a failing file is failed and one without metrics is unprofiled", async () => {
  const failing = await fakeApp(`test("fails", () => expect(1).toBe(2));`);
  const silent = await fakeApp(`test("passes", () => expect(1).toBe(1));`);
  const canary = { name: "Fake", file: "src/Fake.test.ts" };
  const [failed, unprofiled] = await Promise.all([
    runCanary({
      canary,
      sample: 1,
      log: resolve(failing, "a.log"),
      root: failing,
    }),
    runCanary({
      canary,
      sample: 1,
      log: resolve(silent, "b.log"),
      root: silent,
    }),
  ]);
  expect(failed.status).toBe("failed");
  expect(failed.tests).toEqual({ pass: 0, fail: 1 });
  expect(unprofiled.status).toBe("unprofiled");
});

test("a malformed metrics line fails that run instead of the batch", async () => {
  const root = await fakeApp(`
test("prints a bad line", () => {
  console.info('[dual-pane-request-metrics] {"label":"broken"}');
  expect(1).toBe(1);
});`);
  const log = resolve(root, "bad.log");
  const run = await runCanary({
    canary: { name: "Fake", file: "src/Fake.test.ts" },
    sample: 1,
    log,
    root,
  });
  expect(run.status).toBe("failed");
  expect(run.exitCode).toBe(0);
  expect(run.phases).toEqual([]);
  expect(await readFile(log, "utf8")).toContain('{"label":"broken"}');
});

test("a timeout or a missing tally fails the run", () => {
  const phase = parseCanaryOutput(`[dual-pane-request-metrics] ${metrics}`)
    .phases[0];
  if (!phase) throw new Error("The fixture has no phase.");
  const passed = { phases: [phase], tests: { pass: 1, fail: 0 } };
  expect(runStatus(0, false, passed)).toBe("passed");
  expect(runStatus(0, true, passed)).toBe("timed-out");
  expect(runStatus(1, false, passed)).toBe("failed");
  expect(runStatus(0, false, { phases: [phase], tests: null })).toBe("failed");
});
