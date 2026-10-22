import { z } from "zod";
import { arraySchema, loosePlainObject } from "../schema";

/**
 * One organization the session user belongs to, as the user's own conduit to
 * it. This is product state, not access authority: signed group policies and
 * container grants decide access. `syncPaused` is the user's own choice to stop
 * this organization's content syncing to their devices; it changes nothing on
 * the server's access path. `isPersonalOrganizationOwner` marks the user's
 * personal organization, which cannot be paused.
 */
export const OrganizationMembershipResponseSchema = loosePlainObject({
  isPersonalOrganizationOwner: z.boolean(),
  organizationId: z.string(),
  syncPaused: z.boolean(),
});

export type OrganizationMembershipResponse = z.infer<
  typeof OrganizationMembershipResponseSchema
>;

/** Every organization whose roster lists the session user as active. */
export const OrganizationMembershipsResponseSchema = loosePlainObject({
  memberships: arraySchema(OrganizationMembershipResponseSchema),
});

export type OrganizationMembershipsResponse = z.infer<
  typeof OrganizationMembershipsResponseSchema
>;

export function isOrganizationMembershipResponse(
  value: unknown,
): value is OrganizationMembershipResponse {
  return OrganizationMembershipResponseSchema.safeParse(value).success;
}

export function isOrganizationMembershipsResponse(
  value: unknown,
): value is OrganizationMembershipsResponse {
  return OrganizationMembershipsResponseSchema.safeParse(value).success;
}
