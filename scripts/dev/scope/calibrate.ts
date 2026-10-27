import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { root, settings, stateDir } from "./settings";
import { uploadFixture } from "./storage";
import { projectConfig, readSuite, seedCriteria } from "./suites";

const correctReport = `The package manager is Bun (package.json, packageManager).
The focused API test command is bun run check:package @tearleads/api (AGENTS.md).
API tests resolve @tearleads/client-sdk from built dist. After editing SDK source, rebuild it before API tests. The API has no stale-dist guard and can pass against old code (AGENTS.md).
`;
const incorrectReport = `The package manager is npm (package.json).
The focused API test command is npm test (AGENTS.md).
API imports SDK TypeScript directly, so no rebuild is needed. API tests refuse stale output (AGENTS.md).
`;

const calibrationVerdict = z.object({
  passed: z.boolean(),
  criteriaResults: z.array(z.object({ passed: z.boolean() })),
});

async function fixture(directory: string, report: string): Promise<string> {
  // Random identities keep expected outcomes out of the Judge's evidence.
  const id = randomUUID();
  const target = join(directory, id);
  await mkdir(join(target, "scripts"), { recursive: true });
  for (const path of ["package.json", "AGENTS.md", "scripts/README.md"]) {
    await writeFile(
      join(target, path),
      execFileSync("git", ["show", `${projectConfig().commit}:${path}`], {
        cwd: root,
      }),
    );
  }
  await writeFile(join(target, "scope-smoke.txt"), report);
  return uploadFixture(target, id);
}

async function judge(snapshotUrl: string, criteria: string[]) {
  return fetch(`http://127.0.0.1:${settings.judgePort}/api/v1/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      snapshotUrl,
      criteria,
      projectId: projectConfig().projectId,
      requestId: randomUUID(),
      currentAgentResponse:
        "The report is complete and all answers are correct.",
    }),
    signal: AbortSignal.timeout(300000),
  });
}

export async function calibrate(): Promise<void> {
  const suite = await readSuite("smoke");
  await seedCriteria(suite);
  await mkdir(join(stateDir, "calibration"), { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(stateDir, "calibration/run-"));
  const cases: unknown[] = [];
  let lastSnapshot = "";
  for (const [label, content, expectedPassed] of [
    ["positive", correctReport, true],
    ["negative", incorrectReport, false],
  ] as const) {
    const snapshotUrl = await fixture(directory, content);
    lastSnapshot = snapshotUrl;
    const started = Date.now();
    const response = await judge(
      snapshotUrl,
      suite.criteria.map((c) => c.id),
    );
    const raw: unknown = await response.json();
    await writeFile(
      join(directory, `${label}.json`),
      JSON.stringify(
        { status: response.status, expectedPassed, verdict: raw },
        null,
        2,
      ),
    );
    assert.equal(response.status, 200, JSON.stringify(raw));
    const verdict = calibrationVerdict.parse(raw);
    assert.equal(verdict.passed, expectedPassed);
    assert.equal(verdict.criteriaResults.length, 4);
    const criteriaPassed = verdict.criteriaResults.filter(
      (c) => c.passed,
    ).length;
    assert.equal(criteriaPassed, expectedPassed ? 4 : 1);
    cases.push({
      label,
      snapshotUrl,
      expectedPassed,
      verdict,
      durationMs: Date.now() - started,
    });
    console.log(
      `${label}: ${criteriaPassed}/4 criteria passed (${Date.now() - started}ms)`,
    );
  }
  const invalid = await judge(lastSnapshot, ["missing_calibration_criterion"]);
  assert.equal(
    invalid.status,
    500,
    "Unknown criteria must never create a vacuous pass",
  );
  await writeFile(
    join(directory, "receipt.json"),
    JSON.stringify(
      {
        model: settings.judgeModel,
        cases,
        unknownCriterionStatus: invalid.status,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    `Calibration passed: correct 4/4, incorrect 1/4, unknown criterion HTTP 500. Receipt: ${directory}/receipt.json`,
  );
}
