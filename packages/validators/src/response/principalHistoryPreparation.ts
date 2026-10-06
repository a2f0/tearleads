import { z } from "zod";
import { BILLING_ERROR_CODES } from "../billing";
import { registerJsonSchemaRuntimeRefinements } from "../jsonSchema";
import { loosePlainObject, sha256HexStringSchema } from "../schema";

/** Sent only after the attempted operation has rolled back completely. */
export const PrincipalHistoryPreparationResponseSchema = z.strictObject({
  code: z.literal("principal_history_preparation_pending"),
  committed: z.literal(false),
  progressToken: sha256HexStringSchema,
});

export const principalHistoryRollbackRefinement = {
  id: "response.principal-history-preparation-rollback",
  description:
    "A 503 with code principal_history_preparation_unavailable requires committed:false; other 503 responses do not guarantee rollback.",
} as const;

// Preserve the ordinary error envelope; only the exact code plus false marker
// proves rollback. Neither a generic 503 nor the marker alone is sufficient.
export const PrincipalHistoryPreparationFailureResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject({
      error: z.string(),
      code: z
        .literal([
          BILLING_ERROR_CODES.checkoutNoActiveMembers,
          BILLING_ERROR_CODES.rosterOverCapacity,
          "principal_history_preparation_unavailable",
        ])
        .optional(),
      committed: z.boolean().optional(),
    }).superRefine((value, context) => {
      if (
        value.code === "principal_history_preparation_unavailable" &&
        value.committed !== false
      ) {
        context.addIssue({
          code: "custom",
          message: "Preparation refusal must prove the operation rolled back",
          path: ["committed"],
        });
      }
    }),
    [principalHistoryRollbackRefinement],
  );
