import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runScenarioCommand, type ScenarioHost } from "./command";
import { loadScenarioReport, type ScenarioRun } from "./report";
import type { ScenarioRunInput } from "./run";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fakeHost(
  overrides: {
    readonly status?: ScenarioRun["status"];
    readonly requests?: number;
  } = {},
) {
  const root = await mkdtemp(resolve(tmpdir(), "scenario-command-"));
  directories.push(root);
  const inputs: ScenarioRunInput[] = [];
  const printed: string[] = [];
  const host: ScenarioHost = {
    discover: async () => [
      { name: "manyRotations", file: "src/scenarios/manyRotations.test.ts" },
      { name: "stagedBaseline", file: "src/scenarios/stagedBaseline.test.ts" },
    ],
    runScenario: async (input) => {
      inputs.push(input);
      await writeFile(input.log, "1 pass\n0 fail\n");
      const requests = overrides.requests ?? 15;
      const status = overrides.status ?? "passed";
      return {
        scenario: input.scenario.name,
        file: input.scenario.file,
        sample: input.sample,
        status,
        exitCode: status === "passed" ? 0 : 1,
        wallMs: 1200,
        tests: {
          pass: status === "passed" ? 1 : 0,
          fail: status === "passed" ? 0 : 1,
        },
        log: input.log,
        httpCapture: input.httpCapture,
        http:
          status === "passed"
            ? {
                requests,
                requestBytes: 5000,
                responseBytes: 8000,
                serverMs: 95,
                conflicts: 1,
                clientErrors: 1,
                manifestCitations: 3,
                truncated: false,
                statuses: { "200": requests - 1, "409": 1 },
                errorCodes: {},
                operations: { removeFromGroup: 2 },
                byRoute: {
                  "POST /documents/:documentId/sync": {
                    count: requests,
                    conflicts: 1,
                    requestBytes: 5000,
                    responseBytes: 8000,
                    serverMs: 95,
                  },
                },
              }
            : null,
        statements: { status: "off" },
      };
    },
    reportDirectory: resolve(root, "reports"),
    print: (text) => printed.push(text),
  };
  return { host, inputs, printed, root };
}

test("runs selected scenarios, saves reports, and compares with --baseline", async () => {
  const first = await fakeHost({ requests: 20 });
  expect(
    await runScenarioCommand(
      [
        "--scenario",
        "rotation",
        "--statements",
        "--param-hash",
        "--client-statements",
        "--payload-audit",
      ],
      first.host,
    ),
  ).toBe(0);
  expect(first.inputs).toHaveLength(1);
  expect(first.inputs[0]?.scenario.name).toBe("manyRotations");
  expect(first.inputs[0]?.statements?.paramHash).toBe(true);
  expect(first.inputs[0]?.clientSql?.out).toMatch(/\.client-sql\.jsonl$/u);
  expect(first.inputs[0]?.payloadAudit?.out).toMatch(/\.payloads\.jsonl$/u);

  const reportDir = resolve(first.root, "reports");
  const files = await readdir(reportDir);
  const jsonName = files.find((name) => name.endsWith(".json"));
  if (!jsonName) throw new Error("Expected a saved JSON report.");
  const baselinePath = resolve(reportDir, jsonName);

  const second = await fakeHost({ requests: 12 });
  expect(
    await runScenarioCommand(
      ["--scenario", "rotation", "--baseline", baselinePath],
      second.host,
    ),
  ).toBe(0);
  expect(second.printed.join("\n")).toContain("20 → 12 (-8)");
});

test("exits 1 when a scenario run fails", async () => {
  const failed = await fakeHost({ status: "failed" });
  expect(
    await runScenarioCommand(["--scenario", "baseline"], failed.host),
  ).toBe(1);
});

test("supports --compare and rejects corrupted or incomplete saved reports", async () => {
  const first = await fakeHost({ requests: 20 });
  const second = await fakeHost({ requests: 14 });
  await runScenarioCommand(["--scenario", "rotation"], first.host);
  await runScenarioCommand(["--scenario", "rotation"], second.host);
  const firstJson = (await readdir(resolve(first.root, "reports"))).find((f) =>
    f.endsWith(".json"),
  );
  const secondJson = (await readdir(resolve(second.root, "reports"))).find(
    (f) => f.endsWith(".json"),
  );
  if (!firstJson || !secondJson) throw new Error("Expected saved reports.");
  const beforePath = resolve(first.root, "reports", firstJson);
  const afterPath = resolve(second.root, "reports", secondJson);

  const cmp = await fakeHost();
  expect(
    await runScenarioCommand(["--compare", beforePath, afterPath], cmp.host),
  ).toBe(0);
  expect(cmp.inputs).toEqual([]);
  expect(cmp.printed.join("\n")).toContain("20 → 14 (-6)");

  const corruptPath = resolve(first.root, "corrupt.json");
  await writeFile(
    corruptPath,
    JSON.stringify({
      schemaVersion: 1,
      scenario: "bob-and-alice-scenarios",
      summary: [],
      runs: [],
    }),
  );
  await expect(loadScenarioReport(corruptPath)).rejects.toThrow(
    /not a bob-and-alice scenario report/u,
  );

  const incompletePath = resolve(first.root, "incomplete.json");
  await writeFile(
    incompletePath,
    JSON.stringify({
      schemaVersion: 1,
      scenario: "bob-and-alice-scenarios",
      runId: "r-1",
      revision: "abc",
      status: "failed",
      summary: [],
      runs: [],
    }),
  );
  await expect(loadScenarioReport(incompletePath)).rejects.toThrow(
    /compare only complete ones/u,
  );
});
