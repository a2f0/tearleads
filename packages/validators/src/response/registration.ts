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
import { authChallengeHexStringSchema, loosePlainObject } from "../schema";
import { isWalLsnString, WAL_LSN_PATTERN } from "../util/walLsn";
import { addCommitLsnIssues } from "./documentSyncSchema";
import {
  addCommittedUpdateIdIssues,
  organizationProvisioningResponseShape,
} from "./organizationProvisioning";

/**
 * The commit position read after the registration transaction, as a document
 * create's seed reports it, so the client records it for every document the
 * registration seeded: a WAL LSN, or null when it could not be read. Only
 * registration reports one; see `docs/client-sync-ordering.md`.
 */
const registrationCommitCheckpointShape = {
  commitLsn: registerJsonSchemaFragment(z.string().refine(isWalLsnString), {
    pattern: WAL_LSN_PATTERN.source,
    type: "string",
  }).nullable(),
  commitLsnMode: z.union([z.literal("tracked"), z.literal("untracked")]),
} satisfies z.ZodRawShape;

/** Runtime refinements the registration response adds to provisioning's. */
export const registrationCommitCheckpointRefinements = [
  documentSyncResponseCommitLsnModeRefinement,
  documentSyncResponseCommitLsnSentinelRefinement,
] as const;

export const RegistrationResponseSchema = registerJsonSchemaRuntimeRefinements(
  loosePlainObject({
    ...organizationProvisioningResponseShape,
    ...registrationCommitCheckpointShape,
    challenge: authChallengeHexStringSchema,
  }).superRefine((value, context) => {
    addCommittedUpdateIdIssues(value, context);
    addCommitLsnIssues(value, context);
  }),
  [
    organizationProvisioningCommittedUpdateIdsRefinement,
    ...registrationCommitCheckpointRefinements,
  ],
);

export type RegistrationResponse = z.infer<typeof RegistrationResponseSchema>;

export function isRegistrationResponse(
  value: unknown,
): value is RegistrationResponse {
  return RegistrationResponseSchema.safeParse(value).success;
}
