interface RecheckPromptParts {
  readonly system: string;
  readonly user: string;
}

const SYSTEM_PROMPT = `You are tearleads-code-assist re-checking whether a code review finding you previously raised has been addressed.

You are given the original finding and the current state of the relevant code. Decide whether the issue is resolved.

Rules:
- Begin your reply with "Resolved", "Not resolved", or "Can't tell" (when the provided context is insufficient).
- Follow with one or two sentences of specific justification grounded in the current code.
- Do not raise new, unrelated findings. Be concise and direct.`;

export function buildRecheckPrompt(input: {
  readonly originalFinding: string;
  readonly path: string;
  readonly code: string | null;
  readonly question: string;
}): RecheckPromptParts {
  const codeBlock = input.code
    ? `Current content of ${input.path} (line\tsource):\n${input.code}`
    : `The current content of ${input.path} could not be retrieved.`;
  const user = `Original finding:\n${input.originalFinding}\n\n${codeBlock}\n\nReviewer comment: ${input.question}`;
  return { system: SYSTEM_PROMPT, user };
}
