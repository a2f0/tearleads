import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { stateDir } from "../settings";
import {
  blobName,
  extractSnapshot,
  readToolCalls,
  readWorkerLog,
  selectToolEvents,
} from "../storage";
import { readClaudeTranscript } from "./claude-evidence";
import { grade, model } from "./codex";
import { loadCriteria } from "./criteria";
import { evidenceJson, redactText } from "./redaction";

const turnSchema = z
  .object({
    iteration: z.number().int().positive().optional(),
    toolCallsUrl: z.string().url().optional(),
  })
  .passthrough();
export const inputSchema = z.object({
  snapshotUrl: z.string().url(),
  criteria: z.array(z.string().min(1)).min(1).max(50),
  projectId: z.string().uuid(),
  conversationHistory: z.array(turnSchema).default([]),
  currentAgentResponse: z.string().optional(),
  toolCallsUrl: z.string().url().optional(),
  iteration: z.number().int().positive().optional(),
  requestId: z.string().optional(),
  gate: z.enum(["select", "build", "test", "run", "deploy"]).default("select"),
  personaInstructions: z.string().optional(),
});
export type EvaluationInput = z.infer<typeof inputSchema>;

const jobsDir = join(stateDir, "judge/evaluations");

export async function evaluate(input: EvaluationInput) {
  blobName(input.snapshotUrl);
  if (new Set(input.criteria).size !== input.criteria.length)
    throw new Error("Duplicate requested criteria");
  // A fresh provider records exactly the current, project-scoped criterion definitions.
  const criteria = await loadCriteria(input.criteria, input.projectId);
  if (!criteria.length) throw new Error("No criteria resolved");
  for (const criterion of criteria) {
    if (criterion.gates?.length && !criterion.gates.includes(input.gate)) {
      throw new Error(
        `Criterion ${criterion.id} is incompatible with ${input.gate}`,
      );
    }
  }
  await mkdir(jobsDir, { recursive: true, mode: 0o700 });
  const jobDir = await mkdtemp(join(jobsDir, "evaluation-"));
  const workspace = join(jobDir, "workspace");
  const evidence = join(jobDir, "evidence");
  await mkdir(workspace);
  await mkdir(evidence);
  const startedAt = new Date().toISOString();
  const metadata = {
    provider: "codex-cli",
    model,
    startedAt,
    requestId: input.requestId,
    projectId: input.projectId,
    snapshotUrl: input.snapshotUrl,
    gate: input.gate,
    criteria,
  };
  await writeFile(
    join(jobDir, "metadata.json"),
    JSON.stringify(metadata, null, 2),
  );
  try {
    await extractSnapshot(input.snapshotUrl, workspace);
    await writeFile(
      join(evidence, "agent-response.txt"),
      redactText(input.currentAgentResponse || "(No response supplied)"),
    );
    await writeFile(
      join(evidence, "conversation.json"),
      evidenceJson(input.conversationHistory),
    );
    await captureToolOutputs(input, evidence);
    const result = await grade(jobDir, criteria);
    await writeFile(
      join(jobDir, "result.json"),
      JSON.stringify(
        { ...result, model, finishedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        requestId: input.requestId,
        jobDir,
        passed: result.passed,
        criteria: result.criteriaResults.length,
      }),
    );
    return result;
  } catch (error) {
    await writeFile(join(jobDir, "error.txt"), String(error));
    throw error;
  }
}

async function captureToolOutputs(input: EvaluationInput, evidence: string) {
  const log = await readWorkerLog(input.snapshotUrl);
  await writeFile(
    join(evidence, "native-tools.json"),
    evidenceJson(
      await readClaudeTranscript(log?.events ?? [], log?.iteration ?? 1),
    ),
  );
  await writeFile(
    join(evidence, "tool-events.json"),
    evidenceJson({
      format:
        "Scope ACP display events; command/output text can be truncated. These are not complete tool transcripts.",
      events: selectToolEvents(log?.events ?? [], log?.iteration ?? 1),
    }),
  );
  const logs = input.conversationHistory.flatMap((turn, index) =>
    turn.toolCallsUrl
      ? [{ iteration: turn.iteration || index + 1, url: turn.toolCallsUrl }]
      : [],
  );
  if (input.toolCallsUrl)
    logs.push({
      iteration: input.iteration || input.conversationHistory.length + 1,
      url: input.toolCallsUrl,
    });
  const captured = [];
  for (const log of logs) {
    blobName(log.url);
    captured.push({
      iteration: log.iteration,
      toolCalls: await readToolCalls(log.url),
    });
  }
  await writeFile(join(evidence, "tool-outputs.json"), evidenceJson(captured));
}
