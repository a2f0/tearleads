import { z } from "zod";
import {
  nonEmptyStringSchema,
  sha256HexStringSchema,
  uuidV4StringSchema,
} from "../schema";

/** An identity authorizes one fresh personal organization to replace another. */
export const OrganizationReplacementAuthorizationSchema = z.strictObject({
  replacesOrganizationId: uuidV4StringSchema,
  organizationId: uuidV4StringSchema,
  rootContainerId: uuidV4StringSchema,
  userId: uuidV4StringSchema,
  organizationStateHash: sha256HexStringSchema,
  adminGroupId: uuidV4StringSchema,
  adminGroupStateHash: sha256HexStringSchema,
  memberGroupId: uuidV4StringSchema,
  memberGroupStateHash: sha256HexStringSchema,
  rootManifestHash: sha256HexStringSchema,
  rootMetadataDocumentId: uuidV4StringSchema,
  signature: nonEmptyStringSchema,
});

export type OrganizationReplacementAuthorization = z.infer<
  typeof OrganizationReplacementAuthorizationSchema
>;

export function isOrganizationReplacementAuthorization(
  value: unknown,
): value is OrganizationReplacementAuthorization {
  return OrganizationReplacementAuthorizationSchema.safeParse(value).success;
}
