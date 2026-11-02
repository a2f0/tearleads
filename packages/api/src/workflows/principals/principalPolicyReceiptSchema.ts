import { z } from "zod";

/**
 * A stored compound receipt names one head per policy it acknowledged. Each
 * head stays unparsed: `loadPrincipalPolicyOutcomeReference` compares it with
 * the exact request, so the stored value is passed on as it was read. A loose
 * object keeps any other stored key, which no reader consults.
 */
export const storedGroupPolicyReceiptSchema = z.looseObject({
  groupPolicy: z.unknown(),
  organizationPolicy: z.unknown(),
});

/** A commit receipt also names the member policy when the request had one. */
export const storedCommitPolicyReceiptSchema =
  storedGroupPolicyReceiptSchema.extend({
    memberPolicy: z.unknown().optional(),
  });
