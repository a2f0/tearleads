import type OpenAI from "openai";
import { isSeverity, SEVERITIES, type Severity } from "../severity";

export interface ReviewFinding {
  readonly path: string;
  readonly line: number;
  readonly severity: Severity;
  readonly title: string;
  readonly body: string;
  readonly suggestion: string | null;
}

export const SUBMIT_REVIEW_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "submit_review",
    description:
      "Submit the code review as a list of findings anchored to specific lines of the pull request diff.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["findings"],
      properties: {
        findings: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["path", "line", "severity", "title", "body"],
            properties: {
              path: {
                type: "string",
                description: "Repository-relative file path.",
              },
              line: {
                type: "integer",
                description:
                  "Line number in the NEW version of the file (the right side of the diff).",
              },
              severity: { type: "string", enum: [...SEVERITIES] },
              title: {
                type: "string",
                description: "Short one-line summary of the issue.",
              },
              body: {
                type: "string",
                description:
                  "Markdown explanation of the issue and the recommended fix.",
              },
              suggestion: {
                type: "string",
                description:
                  "Optional replacement code for the anchored line(s), as raw code WITHOUT markdown fences.",
              },
            },
          },
        },
      },
    },
  },
};

export function parseFindings(rawArguments: string): ReviewFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    return [];
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("findings" in parsed)
  ) {
    return [];
  }
  const { findings } = parsed;
  if (!Array.isArray(findings)) {
    return [];
  }
  return findings.flatMap((entry) => {
    const finding = toFinding(entry);
    return finding ? [finding] : [];
  });
}

function toFinding(entry: unknown): ReviewFinding | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  if (
    !("path" in entry) ||
    !("line" in entry) ||
    !("severity" in entry) ||
    !("title" in entry) ||
    !("body" in entry)
  ) {
    return null;
  }
  const { path, line, severity, title, body } = entry;
  const suggestion = "suggestion" in entry ? entry.suggestion : undefined;
  if (
    typeof path !== "string" ||
    typeof line !== "number" ||
    typeof severity !== "string" ||
    !isSeverity(severity) ||
    typeof title !== "string" ||
    typeof body !== "string"
  ) {
    return null;
  }
  return {
    path,
    line: Math.trunc(line),
    severity,
    title,
    body,
    suggestion:
      typeof suggestion === "string" && suggestion.length > 0
        ? suggestion
        : null,
  };
}
