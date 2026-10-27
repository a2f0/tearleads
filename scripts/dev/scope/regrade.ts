import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { git } from "./git";
import { apiRequest, settings, stateDir } from "./settings";
import { configSchema } from "./types";

const receiptSchema = z.object({
  snapshot: configSchema,
  cases: z
    .array(
      z.object({
        id: z.string(),
        task: z.string(),
      }),
    )
    .min(1),
});
const runSchema = z.object({
  scenario: z.object({ criteria: z.array(z.string()).min(1) }),
  run: z.object({
    status: z.literal("done"),
    turns: z
      .array(
        z.object({
          snapshotUrl: z.string().url(),
          codingAgentResponse: z.string(),
          toolCallsUrl: z.string().url().optional(),
          iteration: z.literal(1),
        }),
      )
      .length(1),
  }),
});
const resultSchema = z.object({
  passed: z.boolean(),
  criteriaResults: z.array(
    z.object({
      criterionId: z.string(),
      passed: z.boolean(),
      evaluated: z.boolean(),
      feedback: z.string(),
    }),
  ),
});

/** Reuse completed one-turn outputs; original dashboard runs and grades remain intact. */
export async function regrade(path: string): Promise<void> {
  const receipt = receiptSchema.parse(JSON.parse(await readFile(path, "utf8")));
  if (receipt.snapshot.apiUrl !== settings.apiUrl)
    throw new Error("Receipt belongs to a different API");
  const directory = join(stateDir, "regrades", String(Date.now()));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const cases: unknown[] = [];
  const report = {
    sourceReceipt: path,
    snapshot: receipt.snapshot,
    judgeToolingCommit: git("rev-parse", "HEAD"),
    toolingDirty: git("status", "--porcelain").length > 0,
    judgeModel: settings.judgeModel,
    cases,
  };
  console.log(`Regrade receipt: ${directory}/receipt.json`);
  for (const entry of receipt.cases) {
    const run = runSchema.parse(
      await apiRequest(`/requests/${encodeURIComponent(entry.id)}`),
    );
    const turn = run.run.turns[0];
    if (!turn) throw new Error("Missing completed turn");
    const response = await fetch(
      `http://127.0.0.1:${settings.judgePort}/api/v1/evaluate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...turn,
          projectId: receipt.snapshot.projectId,
          currentAgentResponse: turn.codingAgentResponse,
          criteria: run.scenario.criteria,
          requestId: `regrade-${entry.id}`,
        }),
        signal: AbortSignal.timeout(300000),
      },
    );
    const raw: unknown = await response.json();
    await writeFile(
      join(directory, `${entry.id}.json`),
      JSON.stringify(raw, null, 2),
    );
    if (!response.ok)
      throw new Error(`Judge HTTP ${response.status}; inspect ${directory}`);
    const result = resultSchema.parse(raw);
    cases.push({ ...entry, snapshotUrl: turn.snapshotUrl, result });
    await writeFile(
      join(directory, "receipt.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(
      `${entry.task}: ${result.criteriaResults.filter((c) => c.evaluated && c.passed).length}/${result.criteriaResults.length}`,
    );
  }
}
