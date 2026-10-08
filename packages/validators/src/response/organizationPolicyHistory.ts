import { z } from "zod";
import { registerJsonSchemaFragment } from "../jsonSchema";
import { loosePlainObject, nonEmptyStringSchema } from "../schema";
import { ProjectionPolicyEvidenceResponseSchema } from "./projectionPolicyEvidence";

const cursorSchema = registerJsonSchemaFragment(
  z.custom<number>(
    (value) =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 2,
  ),
  { type: "integer", minimum: 2, maximum: Number.MAX_SAFE_INTEGER },
);

/** Display rows per private history page; the API also carries one predecessor. */
export const PRINCIPAL_DISPLAY_HISTORY_PAGE_SIZE = 32;

/** Signed evidence only. Display names are resolved on the client. */
export const OrganizationPolicyHistoryResponseSchema = loosePlainObject({
  organizationId: nonEmptyStringSchema,
  stateHash: nonEmptyStringSchema,
  beforeVersion: cursorSchema,
  nextBeforeVersion: cursorSchema.nullable(),
  evidence: ProjectionPolicyEvidenceResponseSchema,
});

export type OrganizationPolicyHistoryResponse = z.infer<
  typeof OrganizationPolicyHistoryResponseSchema
>;
