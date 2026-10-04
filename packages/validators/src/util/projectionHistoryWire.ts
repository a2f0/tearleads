import { z } from "zod";
import {
  registerJsonSchemaFragment,
  registerJsonSchemaRuntimeRefinements,
} from "../jsonSchema";
import { projectionHistoryHeaderRefinement } from "../projectionHistoryRefinements";
import {
  arraySchema,
  boundedNonEmptyStringSchema,
  boundedPositiveIntegerSchema,
  sha256HexStringSchema,
} from "../schema";

/** Request budgets restrict cache hints, never the history a reader can recover. */
export const PROJECTION_HISTORY_HINT_CHARACTERS = 4096;
const ProjectionHistoryPrefixSchema = z.strictObject({
  key: boundedNonEmptyStringSchema(512),
  count: boundedPositiveIntegerSchema(Number.MAX_SAFE_INTEGER),
  digest: sha256HexStringSchema,
});
export const ProjectionHistoryPrefixesSchema = arraySchema(
  ProjectionHistoryPrefixSchema,
  32,
);
export type ProjectionHistoryPrefix = z.infer<
  typeof ProjectionHistoryPrefixSchema
>;

export function parseProjectionHistoryHints(
  value: string,
): ProjectionHistoryPrefix[] | null {
  try {
    const parsed = ProjectionHistoryPrefixesSchema.safeParse(
      JSON.parse(decodeURIComponent(value)),
    );
    return parsed.success &&
      new Set(parsed.data.map((item) => item.key)).size === parsed.data.length
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

const hintHeader = registerJsonSchemaFragment(
  z.string().max(PROJECTION_HISTORY_HINT_CHARACTERS),
  {
    type: "string",
    maxLength: PROJECTION_HISTORY_HINT_CHARACTERS,
    description:
      "URI-encoded JSON array of exact device-verified history prefixes (key, count, digest); at most 32 unique keys",
  },
);
export const ProjectionHistoryHeadersSchema = z.object({
  "x-projection-history": registerJsonSchemaRuntimeRefinements(
    hintHeader.refine((value) => parseProjectionHistoryHints(value) !== null),
    [projectionHistoryHeaderRefinement],
  ).optional(),
});
