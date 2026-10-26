import { z } from "zod";
import type { Criterion, CriterionResult } from "../types";
import { orderCriteria } from "./criteria";

export const verdictSchema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          criterionId: { type: "string" },
          passed: { type: "boolean" },
          feedback: { type: "string" },
        },
        required: ["criterionId", "passed", "feedback"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

const Verdict = z
  .object({
    results: z
      .array(
        z
          .object({
            criterionId: z.string().min(1),
            passed: z.boolean(),
            feedback: z.string().trim().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

/** Reject incomplete or ambiguous grading; dependency skips are computed in code. */
export function normalizeVerdict(raw: unknown, criteria: Criterion[]) {
  if (!criteria.length) throw new Error("Cannot grade an empty criteria set");
  const { results } = Verdict.parse(raw);
  const ordered = orderCriteria(criteria);
  const expected = new Set(criteria.map((c) => c.id));
  const verdicts = new Map<string, (typeof results)[number]>();
  for (const result of results) {
    if (!expected.has(result.criterionId) || verdicts.has(result.criterionId)) {
      throw new Error(
        `Unexpected or duplicate criterion: ${result.criterionId}`,
      );
    }
    verdicts.set(result.criterionId, result);
  }
  if (verdicts.size !== expected.size)
    throw new Error("Missing criterion verdicts");
  const normalized = new Map<string, CriterionResult>();
  for (const criterion of ordered) {
    const id = criterion.id;
    const blocked = criterion.dependsOn.some(
      (parent) => !normalized.get(parent)?.passed,
    );
    const verdict = verdicts.get(id);
    if (!verdict) throw new Error(`Missing verdict: ${id}`);
    normalized.set(
      id,
      blocked
        ? {
            criterionId: id,
            passed: false,
            evaluated: false,
            feedback: "Skipped because a prerequisite criterion failed.",
          }
        : { ...verdict, evaluated: true },
    );
  }
  const criteriaResults = [...normalized.values()];
  const passed = criteriaResults.every(
    (result) => result.evaluated && result.passed,
  );
  const failures = criteriaResults.filter(
    (result) => result.evaluated && !result.passed,
  );
  const feedback = passed
    ? "All criteria met."
    : failures
        .map((result) => `${result.criterionId}: ${result.feedback}`)
        .join("\n");
  return { passed, feedback: `[Codex Judge] ${feedback}`, criteriaResults };
}
