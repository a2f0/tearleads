import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { logTail } from "../testProcess";
import { parseCanaryOutput } from "./output";
import { phaseStatements, runCanary, runStatus } from "./run";

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

const apiShared = resolve(import.meta.dir, "../../../api-shared/src");

test("captures the API's statements per phase beside the profile", async () => {
  const phaseLine = (label: string) =>
    JSON.stringify(
      `[dual-pane-request-metrics] ${metrics.replace("fake phase", label)}`,
    );
  const root = await fakeApp(`
import { sql } from "drizzle-orm";
import { createDefaultManagedApiDatabase } from ${JSON.stringify(`${apiShared}/adapters/postgres.ts`)};

test("two phases", async () => {
  const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
  await managed.db.execute(sql\`select \${1}\`);
  console.info(${phaseLine("first")});
  await managed.db.execute(sql\`select 2\`);
  await managed.db.execute(sql\`select 3\`);
  console.info(${phaseLine("second")});
  await managed.close();
  expect(1).toBe(1);
});`);
  // Resolve drizzle-orm from the fake app as api-shared does.
  await symlink(
    resolve(apiShared, "../node_modules"),
    resolve(root, "node_modules"),
  );
  const out = resolve(root, "capture.jsonl");
  const run = await runCanary({
    canary: { name: "Fake", file: "src/Fake.test.ts" },
    sample: 1,
    log: resolve(root, "fake.log"),
    capture: { out, paramHash: true },
    root,
  });
  expect(run.status).toBe("passed");
  expect(run.phases.map((phase) => phase.label)).toEqual(["first", "second"]);
  expect(run.statements).toEqual({ capture: out, perPhase: [1, 2] });
  const records = (await readFile(out, "utf8")).trim().split("\n");
  expect(records.map((line) => Object.keys(JSON.parse(line)))).toEqual([
    ["label", "sql", "params", "paramHash"],
    ["phaseEnd", "requests"],
    ["label", "sql", "params", "paramHash"],
    ["label", "sql", "params", "paramHash"],
    ["phaseEnd", "requests"],
  ]);
  expect((await stat(out)).mode & 0o777).toBe(0o600);
});

test("counts no phases from a capture whose markers do not match the run", () => {
  const output = parseCanaryOutput(`[dual-pane-request-metrics] ${metrics}`);
  expect(
    phaseStatements(output, '{"phaseEnd":"fake phase","requests":1}\n'),
  ).toEqual([0]);
  expect(
    phaseStatements(output, '{"phaseEnd":"other","requests":1}\n'),
  ).toBeNull();
  expect(phaseStatements(output, "")).toBeNull();
});
