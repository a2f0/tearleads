import type { z } from "zod";
import {
  loosePlainObject,
  nonEmptyStringSchema,
  positiveIntegerSchema,
} from "../schema";
import { ProjectionPolicyEvidenceResponseSchema } from "./projectionPolicyEvidence";

/** Signed evidence only. Display names are resolved on the client. */
export const OrganizationPolicyHistoryResponseSchema = loosePlainObject({
  organizationId: nonEmptyStringSchema,
  stateHash: nonEmptyStringSchema,
  beforeVersion: positiveIntegerSchema,
  nextBeforeVersion: positiveIntegerSchema.nullable(),
  evidence: ProjectionPolicyEvidenceResponseSchema,
});

export type OrganizationPolicyHistoryResponse = z.infer<
  typeof OrganizationPolicyHistoryResponseSchema
>;
