import { z } from "zod";
import { LEGAL_TERMS_OUTDATED_ERROR_CODE } from "../../legalTerms";
import { loosePlainObject } from "../../schema";

/**
 * A registration's 409. A key that is already registered stays uncoded; a
 * legal terms revision other than the current one carries
 * {@link LEGAL_TERMS_OUTDATED_ERROR_CODE}, so a client built with an earlier
 * revision can tell its users to update instead of to sign in.
 */
export const RegistrationConflictResponseSchema = loosePlainObject({
  code: z.literal(LEGAL_TERMS_OUTDATED_ERROR_CODE).optional(),
  error: z.string().min(1),
});

export type RegistrationConflictResponse = z.infer<
  typeof RegistrationConflictResponseSchema
>;
