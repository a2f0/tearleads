import type { z } from "zod";
import { arraySchema, loosePlainObject } from "../schema";
import { PrincipalPolicyHistorySourceResponseSchema } from "./principalPolicySnapshotPage";
import { ReferencedPrincipalStateResponseSchema } from "./principalReference";
import { PrincipalStatePayloadResponseSchema } from "./principalSnapshot";

/** Pinned public history sources plus the signed directory payloads they need. */
export const ProjectionPolicyEvidenceResponseSchema = loosePlainObject({
  organization: PrincipalPolicyHistorySourceResponseSchema.nullable(),
  organizationPayloads: arraySchema(
    loosePlainObject({
      reference: ReferencedPrincipalStateResponseSchema,
      payload: PrincipalStatePayloadResponseSchema,
    }),
  ),
  groups: arraySchema(PrincipalPolicyHistorySourceResponseSchema),
});

export type ProjectionPolicyEvidenceResponse = z.infer<
  typeof ProjectionPolicyEvidenceResponseSchema
>;

/**
 * The served evidence: a directory payload is `null` exactly when the
 * request cited its organization state as held (`d:` in
 * `x-known-manifests`); decoding fills it from the cited bytes.
 */
export const ProjectionPolicyEvidenceWireResponseSchema = loosePlainObject({
  organization: PrincipalPolicyHistorySourceResponseSchema.nullable(),
  organizationPayloads: arraySchema(
    loosePlainObject({
      reference: ReferencedPrincipalStateResponseSchema,
      payload: PrincipalStatePayloadResponseSchema.nullable(),
    }),
  ),
  groups: arraySchema(PrincipalPolicyHistorySourceResponseSchema),
});

export type ProjectionPolicyEvidenceWireResponse = z.infer<
  typeof ProjectionPolicyEvidenceWireResponseSchema
>;
