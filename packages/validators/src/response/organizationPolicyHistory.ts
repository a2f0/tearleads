import type { z } from "zod";
import { arraySchema, loosePlainObject, nonEmptyStringSchema } from "../schema";
import {
  PrincipalPolicySnapshotResponseSchema,
  PrincipalStatePayloadResponseSchema,
} from "./principal";

/** Signed evidence only. Display names are resolved on the client. */
export const OrganizationPolicyHistoryResponseSchema = loosePlainObject({
  organizationId: nonEmptyStringSchema,
  stateHash: nonEmptyStringSchema,
  organizationPayloads: arraySchema(PrincipalStatePayloadResponseSchema),
  groups: arraySchema(PrincipalPolicySnapshotResponseSchema),
});

export type OrganizationPolicyHistoryResponse = z.infer<
  typeof OrganizationPolicyHistoryResponseSchema
>;
