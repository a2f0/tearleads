import type { z } from "zod";
import { arraySchema, loosePlainObject } from "../schema";
import { PrincipalPolicyHistorySourceResponseSchema } from "./principalPolicySnapshotPage";
import { ReferencedPrincipalStateResponseSchema } from "./principalReference";
import { PrincipalStatePayloadResponseSchema } from "./principalSnapshot";

/** Pinned public history sources plus the signed directory payloads they need. */
export const ProjectionPolicyHistoryEvidenceResponseSchema = loosePlainObject({
  organization: PrincipalPolicyHistorySourceResponseSchema.nullable(),
  organizationPayloads: arraySchema(
    loosePlainObject({
      reference: ReferencedPrincipalStateResponseSchema,
      payload: PrincipalStatePayloadResponseSchema,
    }),
  ),
  groups: arraySchema(PrincipalPolicyHistorySourceResponseSchema),
});

export type ProjectionPolicyHistoryEvidenceResponse = z.infer<
  typeof ProjectionPolicyHistoryEvidenceResponseSchema
>;
