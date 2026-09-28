import type { z } from "zod";
import { arraySchema, loosePlainObject } from "../schema";
import {
  PrincipalPolicySnapshotResponseSchema,
  PrincipalStatePayloadResponseSchema,
} from "./principalSnapshot";

/** Public authorization history only; never group payloads or member envelopes. */
export const ProjectionPolicyEvidenceResponseSchema = loosePlainObject({
  organization: PrincipalPolicySnapshotResponseSchema.nullable(),
  organizationPayloads: arraySchema(PrincipalStatePayloadResponseSchema),
  groups: arraySchema(PrincipalPolicySnapshotResponseSchema),
});

export type ProjectionPolicyEvidenceResponse = z.infer<
  typeof ProjectionPolicyEvidenceResponseSchema
>;
