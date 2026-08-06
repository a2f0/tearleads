import { z } from "zod";
import { isPlainObject } from "../isPlainObject";
import {
  registerJsonSchemaRuntimeRefinements,
  registerJsonSchemaView,
} from "../jsonSchema";
import { organizationProvisioningGroupNameRefinement } from "../organizationProvisioningRefinements";
import { loosePlainObject, uuidV4StringSchema } from "../schema";
import { hasNullableStringProperty, isUuidV4String } from "../util";
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

export interface UpdateOrganizationRosterEntryRequest {
  profileDocumentId: string | null;
}

export interface UpdateOrganizationProfileRequest {
  profileDocumentId: string | null;
}

export function isCreateOrganizationGroupRequest(
  value: unknown,
): value is CreateOrganizationGroupRequest {
  return CreateOrganizationGroupRequestSchema.safeParse(value).success;
}

export function isUpdateOrganizationRosterEntryRequest(
  value: unknown,
): value is UpdateOrganizationRosterEntryRequest {
  return (
    isPlainObject(value) &&
    hasNullableStringProperty(value, "profileDocumentId") &&
    (value.profileDocumentId === null ||
      isUuidV4String(value.profileDocumentId))
  );
}

export function isUpdateOrganizationProfileRequest(
  value: unknown,
): value is UpdateOrganizationProfileRequest {
  return (
    isPlainObject(value) &&
    hasNullableStringProperty(value, "profileDocumentId") &&
    (value.profileDocumentId === null ||
      isUuidV4String(value.profileDocumentId))
  );
}
