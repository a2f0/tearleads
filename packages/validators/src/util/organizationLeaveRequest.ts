import { z } from "zod";
import { registerJsonSchemaFragment } from "../jsonSchema";
import { nonEmptyStringSchema, uuidV4StringSchema } from "../schema";
import {
  CANONICAL_SIGNED_AT_PATTERN,
  isCanonicalSignedAt,
  SIGNED_AT_CONTRACT,
} from "./signedAt";

/**
 * A member's signed request to leave an organization. Signed with the member's
 * identity key so an administrator can tell the request came from the member,
 * not from the server. It authorizes nothing by itself: leaving still needs an
 * administrator to sign the member's removal from the organization's groups.
 */
export const OrganizationLeaveRequestSchema = z.strictObject({
  organizationId: uuidV4StringSchema,
  userId: uuidV4StringSchema,
  requestedAt: registerJsonSchemaFragment(
    z.string().refine(isCanonicalSignedAt, {
      message: `requestedAt must be ${SIGNED_AT_CONTRACT}`,
    }),
    { pattern: CANONICAL_SIGNED_AT_PATTERN.source, type: "string" },
  ),
  signature: nonEmptyStringSchema,
});

export type OrganizationLeaveRequest = z.infer<
  typeof OrganizationLeaveRequestSchema
>;

export function isOrganizationLeaveRequest(
  value: unknown,
): value is OrganizationLeaveRequest {
  return OrganizationLeaveRequestSchema.safeParse(value).success;
}
