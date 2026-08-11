import { z } from "zod";
import {
  registerJsonSchemaRuntimeRefinements,
  registerJsonSchemaView,
} from "../jsonSchema";
import { organizationProvisioningGroupNameRefinement } from "../organizationProvisioningRefinements";
import { loosePlainObject, uuidV4StringSchema } from "../schema";
import { PutPrincipalPolicyRequestSchema } from "./principal";

const NonBlankGroupNameSchema = registerJsonSchemaRuntimeRefinements(
  registerJsonSchemaView(
    z.string().refine((value) => value.trim().length > 0),
    z.string().min(1),
  ),
  [organizationProvisioningGroupNameRefinement],
);

const CreateOrganizationGroupRequestShape = {
  groupId: uuidV4StringSchema,
  initialGroupPolicy: PutPrincipalPolicyRequestSchema,
  name: NonBlankGroupNameSchema,
};

export const CreateOrganizationGroupRequestSchema = loosePlainObject(
  CreateOrganizationGroupRequestShape,
);

export const CreateOrganizationGroupWithPolicyRequestSchema = loosePlainObject({
  ...CreateOrganizationGroupRequestShape,
  organizationPolicy: PutPrincipalPolicyRequestSchema,
});

export type CreateOrganizationGroupRequest = z.infer<
  typeof CreateOrganizationGroupRequestSchema
>;

export type CreateOrganizationGroupWithPolicyRequest = z.infer<
  typeof CreateOrganizationGroupWithPolicyRequestSchema
>;

export const DeleteOrganizationGroupRequestSchema = loosePlainObject({
  organizationPolicy: PutPrincipalPolicyRequestSchema,
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
