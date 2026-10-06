import { z } from "zod";
import { sha256HexStringSchema } from "../schema";

/** Sent only after the attempted operation has rolled back completely. */
export const PrincipalHistoryPreparationResponseSchema = z.strictObject({
  code: z.literal("principal_history_preparation_pending"),
  committed: z.literal(false),
  progressToken: sha256HexStringSchema,
});
