import type { z } from "zod";
import { registerJsonSchemaRuntimeRefinements } from "../jsonSchema";
import {
  organizationProvisioningContainerSeedRefinement,
  organizationProvisioningDocumentSeedRefinement,
} from "../organizationProvisioningRefinements";
import { arraySchema, loosePlainObject, uuidV4StringSchema } from "../schema";
import { ContainerMutationRequestSchema } from "./container";
import { containerCreateWithMetadataDocumentRequestShape } from "./containerMetadata";
import {
  DocumentSyncRequestSchema,
  documentCreateRequestShape,
} from "./document";
import { CreateOrganizationGroupRequestSchema } from "./organization";
import { OrganizationPrincipalPolicyRequestSchema } from "./principal";

/**
 * A built-in or app-owned system container whose encrypted initial metadata
 * body is committed in the same transaction as the organization and document
 * shell.
 */
const provisionedSystemContainerRequestShape = {
  ...containerCreateWithMetadataDocumentRequestShape,
  initialMetadataSync: DocumentSyncRequestSchema,
};

/**
 * A document whose encrypted initial body is committed with its manifest in the
 * organization-provisioning transaction.
 */
const provisionedDocumentRequestShape = {
  ...documentCreateRequestShape,
  initialSync: DocumentSyncRequestSchema,
};

export const ProvisionedDocumentRequestSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject(provisionedDocumentRequestShape).superRefine(
      (value, context) => {
        if (!Array.isArray(value.initialSync?.outgoingUpdates)) {
          return;
        }
        if (
          value.initialSync.outgoingUpdates.length !== 1 ||
          (value.initialSync.containerRekeys?.length ?? 0) !== 0
        ) {
          context.addIssue({
            code: "custom",
            message:
              "provisioned document seed requires one update and no container rekeys",
            path: ["initialSync"],
          });
        }
      },
    ),
    [organizationProvisioningDocumentSeedRefinement],
  );

export type ProvisionedDocumentRequest = z.infer<
  typeof ProvisionedDocumentRequestSchema
>;

export const ProvisionedSystemContainerRequestSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject(provisionedSystemContainerRequestShape).superRefine(
      (value, context) => {
        if (!Array.isArray(value.initialMetadataSync?.outgoingUpdates)) {
          return;
        }
        if (
          value.initialMetadataSync.outgoingUpdates.length !== 1 ||
          (value.initialMetadataSync.containerRekeys?.length ?? 0) !== 0
        ) {
          context.addIssue({
            code: "custom",
            message:
              "provisioned system-container metadata seed requires one update and no container rekeys",
            path: ["initialMetadataSync"],
          });
        }
      },
    ),
    [organizationProvisioningContainerSeedRefinement],
  );

export type ProvisionedSystemContainerRequest = z.infer<
  typeof ProvisionedSystemContainerRequestSchema
>;

export function isProvisionedDocumentRequest(
  value: unknown,
): value is ProvisionedDocumentRequest {
  return ProvisionedDocumentRequestSchema.safeParse(value).success;
}

export function isProvisionedSystemContainerRequest(
  value: unknown,
): value is ProvisionedSystemContainerRequest {
  return ProvisionedSystemContainerRequestSchema.safeParse(value).success;
}

/**
 * The client-signed artifacts required to bootstrap a fresh organization: the
 * organization + admin/member group policies, the signed root container and its
 * metadata document, and the optional roster/organization profile documents.
 *
 * This is the shared shape between user registration (which bootstraps the
 * user's personal organization) and creating an additional organization for an
 * existing user. Registration additionally carries the new user's public key
 * material (see {@link RegistrationRequest}); creating an additional
 * organization reuses the caller's existing keys, so it needs only this base.
 */
export const organizationProvisioningRequestShape = {
  initialAdminGroup: CreateOrganizationGroupRequestSchema,
  initialMemberGroup: CreateOrganizationGroupRequestSchema,
  initialOrganizationMetadataContainer:
    ProvisionedSystemContainerRequestSchema.optional(),
  initialOrganizationPolicy: OrganizationPrincipalPolicyRequestSchema,
  initialOrganizationProfileDocument:
    ProvisionedDocumentRequestSchema.optional(),
  initialRootContainer: ContainerMutationRequestSchema,
  initialRootMetadataDocument: ProvisionedDocumentRequestSchema,
  initialRosterProfileContainer:
    ProvisionedSystemContainerRequestSchema.optional(),
  initialRosterProfileDocument: ProvisionedDocumentRequestSchema.optional(),
  initialSystemContainers: arraySchema(
    ProvisionedSystemContainerRequestSchema,
  ).optional(),
  organizationId: uuidV4StringSchema,
  rootContainerId: uuidV4StringSchema,
  userId: uuidV4StringSchema,
} satisfies z.ZodRawShape;

export const OrganizationProvisioningRequestSchema = loosePlainObject(
  organizationProvisioningRequestShape,
);

export type OrganizationProvisioningRequest = z.infer<
  typeof OrganizationProvisioningRequestSchema
>;

export function isOrganizationProvisioningRequest(
  value: unknown,
): value is OrganizationProvisioningRequest {
  return OrganizationProvisioningRequestSchema.safeParse(value).success;
}

/**
 * Request to create an additional organization for the authenticated user. The
 * caller re-signs the same provisioning artifacts as registration, but with
 * their existing identity keys, so the request is exactly an
 * {@link OrganizationProvisioningRequest} where `userId` is the caller.
 */
export const CreateOrganizationRequestSchema = loosePlainObject({
  ...organizationProvisioningRequestShape,
  /**
   * Purged personal organization this fresh organization replaces. The server
   * accepts this only after the old organization's purge is complete and then
   * moves the user's default-organization pointer atomically.
   */
  replacesOrganizationId: uuidV4StringSchema.optional(),
});

export type CreateOrganizationRequest = z.infer<
  typeof CreateOrganizationRequestSchema
>;

export function isCreateOrganizationRequest(
  value: unknown,
): value is CreateOrganizationRequest {
  return CreateOrganizationRequestSchema.safeParse(value).success;
}
