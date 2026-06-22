import type OpenAI from "openai";
import { buildRecheckPrompt } from "./buildRecheckPrompt";

const FALLBACK =
  "I couldn't determine whether this is resolved from the available context.";

export async function recheckFinding(input: {
  readonly client: OpenAI;
  readonly model: string;
  readonly originalFinding: string;
  readonly path: string;
  readonly code: string | null;
  readonly question: string;
}): Promise<string> {
  const { system, user } = buildRecheckPrompt({
    originalFinding: input.originalFinding,
    path: input.path,
    code: input.code,
    question: input.question,
  });
  const completion = await input.client.chat.completions.create({
    model: input.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const content = completion.choices[0]?.message.content;
  return content && content.trim().length > 0 ? content.trim() : FALLBACK;
}
