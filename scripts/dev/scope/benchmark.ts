import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { git } from "./git";
import { isCompleted } from "./run-state";
import { apiRequest, settings, stateDir } from "./settings";
import { projectConfig, readSuite, seedCriteria } from "./suites";

const runSchema = z
  .object({
    id: z.string(),
    agentVersion: z.string().optional(),
    model: z.string().optional(),
    run: z
      .object({
        status: z.string(),
        outcome: z.string().optional(),
        durationMs: z.number().optional(),
        turns: z
          .array(
            z
              .object({
                passed: z.boolean().optional(),
                codingAgentResponse: z.string().optional(),
                criteriaResults: z
                  .array(
                    z.object({
                      criterionId: z.string(),
                      passed: z.boolean(),
                      evaluated: z.boolean(),
                      feedback: z.string(),
                    }),
                  )
                  .optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

export async function benchmark(
  name: "smoke" | "agent-friendliness",
  count = 1,
): Promise<void> {
  if (!Number.isInteger(count) || count < 1 || count > 10)
    throw new Error("Count must be 1–10");
  const config = projectConfig();
  const suite = await readSuite(name);
  await seedCriteria(suite);
  const directory = join(stateDir, "benchmarks", `${Date.now()}-${suite.id}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const cases: unknown[] = [];
  const receipt = {
    suite,
    snapshot: config,
    toolingCommit: git("rev-parse", "HEAD"),
    toolingDirty: git("status", "--porcelain").length > 0,
    judgeModel: settings.judgeModel,
    coderModel: "provider default; inspect recorded run metadata",
    startedAt: new Date().toISOString(),
    repetitions: count,
    cases,
  };
  const persist = () =>
    writeFile(
      join(directory, "receipt.json"),
      JSON.stringify(receipt, null, 2),
    );
  await persist();
  console.log(`${suite.description}\nReceipt: ${directory}`);
  // One native worker owns upstream's /tmp/workspaces. Submit sequentially.
  for (let trial = 1; trial <= count; trial++) {
    for (const task of suite.tasks) {
      const submitted = z.object({ id: z.string() }).parse(
        await apiRequest(
          `/requests?worker=coder-acp-claude-code&projectId=${encodeURIComponent(config.projectId)}`,
          {
            scenario: { task: task.prompt, criteria: task.criteria },
            codebase: config.revisionId,
            maxIterations: 1,
          },
        ),
      );
      const entry = {
        task: task.id,
        trial,
        id: submitted.id,
        url: `http://127.0.0.1:${settings.portalPort}/runs/${submitted.id}`,
      };
      cases.push(entry);
      await persist();
      console.log(`${task.id} trial ${trial}: ${entry.url}`);
      const run = await waitForRun(
        entry,
        join(directory, `${task.id}-${trial}.json`),
      );
      Object.assign(entry, {
        outcome: run.run.outcome,
        durationMs: run.run.durationMs,
        agentVersion: run.agentVersion,
        model: run.model,
        turns: run.run.turns,
      });
      await persist();
      const results = run.run.turns?.at(-1)?.criteriaResults ?? [];
      const ids = new Set(results.map((result) => result.criterionId));
      if (
        ids.size !== results.length ||
        task.criteria.some((id) => !ids.has(id))
      ) {
        throw new Error(`Missing or ambiguous scores; inspect ${entry.url}`);
      }
      console.log(`${task.id}: ${run.run.outcome ?? run.run.status}`);
    }
  }
  console.log(
    `Finished ${cases.length} trials. Review criteria and friction in ${directory}/receipt.json`,
  );
}

async function waitForRun(
  entry: { id: string; url: string; task: string },
  file: string,
) {
  const deadline = Date.now() + 15 * 60 * 1000;
  let lastStatus = "";
  while (true) {
    const raw = await apiRequest(`/requests/${entry.id}`);
    const run = runSchema.parse(raw);
    await writeFile(file, JSON.stringify(raw, null, 2));
    if (run.run.status !== lastStatus) {
      console.log(`${entry.task}: ${run.run.status}`);
      lastStatus = run.run.status;
    }
    if (isCompleted(run.run.status, run.run.outcome)) {
      return run;
    }
    if (Date.now() >= deadline)
      throw new Error(
        `Timed out; run is still active at ${entry.url}. Inspect before resubmitting.`,
      );
    await Bun.sleep(5000);
  }
}
