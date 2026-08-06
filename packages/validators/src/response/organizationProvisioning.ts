import { z } from "zod";
import { registerJsonSchemaRuntimeRefinements } from "../jsonSchema";
import { organizationProvisioningCommittedUpdateIdsRefinement } from "../organizationProvisioningRefinements";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  uuidV4StringSchema,
} from "../schema";
import { ContainerCreateWithMetadataDocumentResponseSchema } from "./containerMetadata";
import { DocumentCreateResponseSchema } from "./documentMutation";

/**
 * The bootstrapped state of a freshly provisioned organization: the ids and
 * signed root metadata the client needs to open the organization locally, plus
 * the optional roster/organization profile artifacts.
 *
 * Shared by user registration (which additionally issues an auth challenge, see
 * {@link RegistrationResponse}) and creating an additional organization for an
 * already-authenticated user ({@link CreateOrganizationResponse}).
 */
const committedUpdateIdsSchema = arraySchema(uuidV4StringSchema);

export const organizationProvisioningResponseShape = {
  committedCoreMetadataUpdateIds: committedUpdateIdsSchema,
  committedProfileUpdateIds: committedUpdateIdsSchema,
  organizationId: z.string(),
  organizationMetadataContainer:
    ContainerCreateWithMetadataDocumentResponseSchema.optional(),
  organizationMetadataContainerId: z.string().optional(),
  organizationProfileDocument: DocumentCreateResponseSchema.optional(),
  organizationProfileDocumentId: z.string().optional(),
  rootContainerId: z.string(),
  rootMetadataAccessEpoch: z.number(),
  rootMetadataAccessStateHash: nonEmptyStringSchema,
  rootMetadataDocument: DocumentCreateResponseSchema,
  rootMetadataDocumentId: z.string(),
  rosterProfileContainer:
    ContainerCreateWithMetadataDocumentResponseSchema.optional(),
  rosterProfileContainerId: z.string().optional(),
  rosterProfileDocument: DocumentCreateResponseSchema.optional(),
  rosterProfileDocumentId: z.string().optional(),
  systemContainers: arraySchema(
    ContainerCreateWithMetadataDocumentResponseSchema,
  ),
  userId: z.string(),
} satisfies z.ZodRawShape;

export function addCommittedUpdateIdIssues(
  value: z.output<z.ZodObject<typeof organizationProvisioningResponseShape>>,
  context: z.core.$RefinementCtx<unknown>,
): void {
  for (const key of [
    "committedCoreMetadataUpdateIds",
    "committedProfileUpdateIds",
  ] as const) {
    if (!Array.isArray(value[key])) {
      continue;
    }
    if (new Set(value[key]).size !== value[key].length) {
      context.addIssue({
        code: "custom",
        message: "committed update ids must be unique",
        path: [key],
      });
    }
  }
}

export const OrganizationProvisioningResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject(organizationProvisioningResponseShape).superRefine(
      addCommittedUpdateIdIssues,
    ),
    [organizationProvisioningCommittedUpdateIdsRefinement],
  );

export type OrganizationProvisioningResponse = z.infer<
  typeof OrganizationProvisioningResponseSchema
>;

export function isOrganizationProvisioningResponse(
  value: unknown,
): value is OrganizationProvisioningResponse {
  return OrganizationProvisioningResponseSchema.safeParse(value).success;
}

/**
 * Response to creating an additional organization for the authenticated user.
 * The user is already registered, so unlike registration this carries no auth
 * challenge — it is exactly the shared provisioning result.
 */
export type CreateOrganizationResponse = OrganizationProvisioningResponse;

export function isCreateOrganizationResponse(
  value: unknown,
): value is CreateOrganizationResponse {
  return isOrganizationProvisioningResponse(value);
}
