import { z } from "zod";
import {
  documentSyncResponseCommitLsnModeRefinement,
  documentSyncResponseCommitLsnSentinelRefinement,
} from "../documentSyncRefinements";
import {
  registerJsonSchemaFragment,
  registerJsonSchemaRuntimeRefinements,
} from "../jsonSchema";
import { organizationProvisioningCommittedUpdateIdsRefinement } from "../organizationProvisioningRefinements";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  uuidV4StringSchema,
} from "../schema";
import { OrganizationReplacementAuthorizationSchema } from "../util/organizationReplacement";
import { isWalLsnString, WAL_LSN_PATTERN } from "../util/walLsn";
import { ContainerCreateWithMetadataDocumentResponseSchema } from "./containerMetadata";
import { DocumentCreateResponseSchema } from "./documentMutation";
import { addCommitLsnIssues } from "./documentSyncSchema";

/**
 * The bootstrapped state of a freshly provisioned organization: the ids and
 * signed personal and organization metadata roots the client needs to open the
 * organization locally, plus the optional roster/organization profile artifacts.
 *
 * Shared by user registration (which additionally issues an auth challenge, see
 * {@link RegistrationResponse}) and creating an additional organization for an
 * already-authenticated user ({@link CreateOrganizationResponse}).
 */
const committedUpdateIdsSchema = arraySchema(uuidV4StringSchema);

/** What provisioning committed; a replay can return it again. */
const organizationProvisioningResultShape = {
  committedCoreMetadataUpdateIds: committedUpdateIdsSchema,
  committedProfileUpdateIds: committedUpdateIdsSchema,
  organizationId: z.string(),
  organizationMetadataContainer:
    ContainerCreateWithMetadataDocumentResponseSchema,
  organizationMetadataContainerId: z.string(),
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

/**
 * The provisioning result plus the commit position read after its
 * transaction, as a document create's seed reports it, so the client records
 * it for every document the provisioning seeded. The position is a WAL LSN,
 * or null when it could not be read after the commit.
 */
export const organizationProvisioningResponseShape = {
  ...organizationProvisioningResultShape,
  commitLsn: registerJsonSchemaFragment(z.string().refine(isWalLsnString), {
    pattern: WAL_LSN_PATTERN.source,
    type: "string",
  }).nullable(),
  commitLsnMode: z.union([z.literal("tracked"), z.literal("untracked")]),
} satisfies z.ZodRawShape;

/** Refinements of a provisioning response that carries its commit position. */
export const organizationProvisioningResponseRefinements = [
  organizationProvisioningCommittedUpdateIdsRefinement,
  documentSyncResponseCommitLsnModeRefinement,
  documentSyncResponseCommitLsnSentinelRefinement,
] as const;

export function addProvisioningResponseIssues(
  value: z.output<z.ZodObject<typeof organizationProvisioningResponseShape>>,
  context: z.core.$RefinementCtx<unknown>,
): void {
  addCommittedUpdateIdIssues(value, context);
  addCommitLsnIssues(value, context);
}

function addCommittedUpdateIdIssues(
  value: z.output<z.ZodObject<typeof organizationProvisioningResultShape>>,
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
      addProvisioningResponseIssues,
    ),
    organizationProvisioningResponseRefinements,
  );

export type OrganizationProvisioningResponse = z.infer<
  typeof OrganizationProvisioningResponseSchema
>;

export function isOrganizationProvisioningResponse(
  value: unknown,
): value is OrganizationProvisioningResponse {
  return OrganizationProvisioningResponseSchema.safeParse(value).success;
}

const replacementAuthorizationShape = {
  replacementAuthorization:
    OrganizationReplacementAuthorizationSchema.nullable(),
};

/**
 * Response to creating an additional organization for the authenticated user.
 * The user is already registered, so unlike registration this carries no auth
 * challenge. Replacements additionally carry identity-signed recovery intent.
 */
export const CreateOrganizationResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject({
      ...organizationProvisioningResponseShape,
      ...replacementAuthorizationShape,
    }).superRefine(addProvisioningResponseIssues),
    organizationProvisioningResponseRefinements,
  );

export type CreateOrganizationResponse = z.infer<
  typeof CreateOrganizationResponseSchema
>;

export function isCreateOrganizationResponse(
  value: unknown,
): value is CreateOrganizationResponse {
  return CreateOrganizationResponseSchema.safeParse(value).success;
}

/**
 * The create result an organization stores for replay: the response without
 * its commit position, which each response reads anew after its transaction.
 */
export const StoredCreateOrganizationResultSchema = loosePlainObject({
  ...organizationProvisioningResultShape,
  ...replacementAuthorizationShape,
}).superRefine(addCommittedUpdateIdIssues);

export type StoredCreateOrganizationResult = z.infer<
  typeof StoredCreateOrganizationResultSchema
>;

export function isStoredCreateOrganizationResult(
  value: unknown,
): value is StoredCreateOrganizationResult {
  return StoredCreateOrganizationResultSchema.safeParse(value).success;
}
