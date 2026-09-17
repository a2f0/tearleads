import { z } from "zod";
import { loosePlainObject, uuidV4StringSchema } from "../schema";
import {
  OrganizationPrincipalPolicyRequestSchema,
  PutPrincipalPolicyRequestSchema,
} from "./principal";

const CreateOrganizationGroupRequestShape = {
  groupId: uuidV4StringSchema,
  initialGroupPolicy: PutPrincipalPolicyRequestSchema,
};

export const CreateOrganizationGroupRequestSchema = z.strictObject(
  CreateOrganizationGroupRequestShape,
);

export const CreateOrganizationGroupWithPolicyRequestSchema = z.strictObject({
  ...CreateOrganizationGroupRequestShape,
  organizationPolicy: OrganizationPrincipalPolicyRequestSchema,
});

export type CreateOrganizationGroupRequest = z.infer<
  typeof CreateOrganizationGroupRequestSchema
>;

export type CreateOrganizationGroupWithPolicyRequest = z.infer<
  typeof CreateOrganizationGroupWithPolicyRequestSchema
>;

export const DeleteOrganizationGroupRequestSchema = loosePlainObject({
  organizationPolicy: OrganizationPrincipalPolicyRequestSchema,
});

export type DeleteOrganizationGroupRequest = z.infer<
  typeof DeleteOrganizationGroupRequestSchema
>;

export const OrganizationReadModelQuerySchema = loosePlainObject({
  cursor: z.string().optional(),
});

export type OrganizationReadModelQuery = z.infer<
  typeof OrganizationReadModelQuerySchema
>;

export const UpdateOrganizationRosterEntryRequestSchema = loosePlainObject({
  profileDocumentId: uuidV4StringSchema.nullable(),
});

export type UpdateOrganizationRosterEntryRequest = z.infer<
  typeof UpdateOrganizationRosterEntryRequestSchema
>;

export const UpdateOrganizationProfileRequestSchema = loosePlainObject({
  profileDocumentId: uuidV4StringSchema.nullable(),
});

export type UpdateOrganizationProfileRequest = z.infer<
  typeof UpdateOrganizationProfileRequestSchema
>;

export function isCreateOrganizationGroupRequest(
  value: unknown,
): value is CreateOrganizationGroupRequest {
  return CreateOrganizationGroupRequestSchema.safeParse(value).success;
}

export function isCreateOrganizationGroupWithPolicyRequest(
  value: unknown,
): value is CreateOrganizationGroupWithPolicyRequest {
  return CreateOrganizationGroupWithPolicyRequestSchema.safeParse(value)
    .success;
}

export function isDeleteOrganizationGroupRequest(
  value: unknown,
): value is DeleteOrganizationGroupRequest {
  return DeleteOrganizationGroupRequestSchema.safeParse(value).success;
}

export function isUpdateOrganizationRosterEntryRequest(
  value: unknown,
): value is UpdateOrganizationRosterEntryRequest {
  return UpdateOrganizationRosterEntryRequestSchema.safeParse(value).success;
}

export function isUpdateOrganizationProfileRequest(
  value: unknown,
): value is UpdateOrganizationProfileRequest {
  return UpdateOrganizationProfileRequestSchema.safeParse(value).success;
}
