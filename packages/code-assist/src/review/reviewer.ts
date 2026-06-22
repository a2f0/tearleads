import type OpenAI from "openai";
import { buildReviewPrompt } from "./buildReviewPrompt";
import {
  parseFindings,
  type ReviewFinding,
  SUBMIT_REVIEW_TOOL,
} from "./reviewSchema";

interface ReviewRequest {
  readonly client: OpenAI;
  readonly model: string;
  readonly diff: string;
  readonly styleguide: string | null;
}

export async function generateReview(
  request: ReviewRequest,
): Promise<ReviewFinding[]> {
  const { client, model, diff, styleguide } = request;
  const { system, user } = buildReviewPrompt(diff, styleguide);

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    tools: [SUBMIT_REVIEW_TOOL],
    tool_choice: { type: "function", function: { name: "submit_review" } },
  });

  const choice = completion.choices[0];
  if (!choice) {
    return [];
  }

  const toolCall = choice.message.tool_calls?.find(
    (call) =>
      call.type === "function" && call.function.name === "submit_review",
  );
  if (toolCall && toolCall.type === "function") {
    return parseFindings(toolCall.function.arguments);
  }

  // Fallback: some providers occasionally emit the JSON in content instead.
  const content = choice.message.content;
  if (typeof content === "string" && content.includes("findings")) {
    return parseFindings(content);
  }
  return [];
}
