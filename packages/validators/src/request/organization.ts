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

export const CreateOrganizationGroupRequestSchema = loosePlainObject({
  groupId: uuidV4StringSchema,
  initialGroupPolicy: PutPrincipalPolicyRequestSchema,
  name: NonBlankGroupNameSchema,
});

export type CreateOrganizationGroupRequest = z.infer<
  typeof CreateOrganizationGroupRequestSchema
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
