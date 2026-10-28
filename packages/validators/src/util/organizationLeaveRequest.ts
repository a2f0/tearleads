import { z } from "zod";
import { registerJsonSchemaFragment } from "../jsonSchema";
import {
  boundedPositiveIntegerSchema,
  nonEmptyStringSchema,
  uuidV4StringSchema,
} from "../schema";
import {
  CANONICAL_SIGNED_AT_PATTERN,
  isCanonicalSignedAt,
  SIGNED_AT_CONTRACT,
} from "./signedAt";

/**
 * The exact signed head of the organization's reserved Members group that the
 * member saw when asking. Removing anyone from Members rotates its key epoch,
 * so a request stays current only while the member has stayed in Members
 * since this head: a request from an earlier membership never is.
 */
export const OrganizationLeaveRequestMembersHeadSchema = z.strictObject({
  principalId: uuidV4StringSchema,
  version: boundedPositiveIntegerSchema(Number.MAX_SAFE_INTEGER),
  keyEpoch: boundedPositiveIntegerSchema(Number.MAX_SAFE_INTEGER),
  stateHash: nonEmptyStringSchema,
  keyFingerprint: nonEmptyStringSchema,
});

export type OrganizationLeaveRequestMembersHead = z.infer<
  typeof OrganizationLeaveRequestMembersHeadSchema
>;

/**
 * A member's signed request to leave an organization. Signed with the member's
 * identity key so an administrator can tell the request came from the member,
 * not from the server, and bound to the Members head the member saw so it
 * cannot outlive their membership. It authorizes nothing by itself: leaving
 * still needs an administrator to sign the member's removal from the
 * organization's groups.
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
  membersHead: OrganizationLeaveRequestMembersHeadSchema,
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
