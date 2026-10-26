import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { redactEvidence } from "./redaction";

const eventSchema = z.object({
  source: z.literal("coder-acp-claude-code"),
  message: z.string(),
  data: z
    .object({
      workspacePath: z.string().optional(),
      iteration: z.number().optional(),
    })
    .optional(),
});

/** Resolve only the exact native Scope session named in this run's service log. */
export function transcriptIdentity(events: unknown[], iteration: number) {
  let workspace: string | undefined;
  let session: string | undefined;
  for (const value of events) {
    const parsed = eventSchema.safeParse(value);
    if (!parsed.success) continue;
    const event = parsed.data;
    if (event.message === "Fresh workspace created")
      workspace = event.data?.workspacePath;
    if (
      event.data?.iteration === iteration &&
      event.message.startsWith("Created session: ")
    ) {
      session = event.message.slice("Created session: ".length);
    }
  }
  if (
    !workspace ||
    !/^\/(?:private\/)?tmp\/workspaces\/project-[a-f0-9]+$/.test(workspace) ||
    !session ||
    !z.string().uuid().safeParse(session).success
  )
    return undefined;
  return { workspace: workspace.replace(/^\/private/, ""), session };
}

/** Keep observed calls/results, never private reasoning, auth metadata or old grades. */
export function toolRecords(values: unknown[], session: string) {
  const recordSchema = z.object({
    sessionId: z.literal(session),
    type: z.enum(["assistant", "user"]),
    timestamp: z.string().optional(),
    message: z.object({
      model: z.string().optional(),
      content: z.array(z.unknown()),
    }),
  });
  const partSchema = z.discriminatedUnion("type", [
    z.object({
      type: z.literal("tool_use"),
      id: z.string(),
      name: z.string(),
      input: z.unknown(),
    }),
    z.object({
      type: z.literal("tool_result"),
      tool_use_id: z.string(),
      content: z.unknown(),
      is_error: z.boolean().optional(),
    }),
  ]);
  return values.flatMap((value) => {
    const parsed = recordSchema.safeParse(value);
    if (!parsed.success) return [];
    const record = parsed.data;
    const content = record.message.content.flatMap((part) => {
      const parsedPart = partSchema.safeParse(part);
      if (!parsedPart.success) return [];
      const data = parsedPart.data;
      return [
        data.type === "tool_use"
          ? { ...data, input: redactEvidence(data.input) }
          : { ...data, content: redactEvidence(data.content) },
      ];
    });
    return content.length
      ? [{ timestamp: record.timestamp, model: record.message.model, content }]
      : [];
  });
}

export async function readClaudeTranscript(
  events: unknown[],
  iteration: number,
) {
  const identity = transcriptIdentity(events, iteration);
  if (!identity)
    return {
      available: false,
      reason: "No native session identity in run log",
    };
  for (const workspace of [
    `/private${identity.workspace}`,
    identity.workspace,
  ]) {
    const project = workspace.replaceAll("/", "-");
    const path = join(
      homedir(),
      ".claude/projects",
      project,
      `${identity.session}.jsonl`,
    );
    try {
      const lines = (await readFile(path, "utf8"))
        .split("\n")
        .filter((line) => line.trim());
      const records = toolRecords(
        lines.map((line) => JSON.parse(line) as unknown),
        identity.session,
      );
      return {
        available: records.length > 0,
        sessionId: identity.session,
        workspace,
        records,
      };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        continue;
      throw error;
    }
  }
  return {
    available: false,
    sessionId: identity.session,
    reason: "Native session file unavailable",
  };
}
