import type { CommitOrganizationGroupPolicyRequest } from "@tearleads/validators/request";
import {
  type CommitOrganizationGroupPolicyResult,
  runCommitOrganizationGroupPolicyWorkflow,
} from "../../workflows/principals/commitOrganizationGroupPolicy";
import {
  rebuildCommitMemberEnvelopes,
  rebuildMemberEnvelopes,
} from "../../workflows/principals/memberEnvelopeReferences";
import {
  type PutPrincipalPolicyInput,
  type PutPrincipalPolicyResult,
  runPutPrincipalPolicyWorkflow,
} from "../../workflows/principals/putPrincipalPolicy";
import { createIdentityBoundDatabaseWorkflowService } from "../identityBoundDatabaseWorkflowService";

export const putPrincipalPolicy = createIdentityBoundDatabaseWorkflowService<
  PutPrincipalPolicyInput,
  PutPrincipalPolicyResult
>(async (db, input, identityTrustDomain) =>
  runPutPrincipalPolicyWorkflow(
    db,
    {
      ...(await rebuildMemberEnvelopes(db, input)),
      expectedPrincipalId: input.expectedPrincipalId,
      expectedPrincipalType: input.expectedPrincipalType,
      requesterUserId: input.requesterUserId,
    },
    identityTrustDomain,
  ),
);

interface CommitOrganizationGroupPolicyServiceInput {
  readonly groupId: string;
  readonly organizationId: string;
  readonly request: CommitOrganizationGroupPolicyRequest;
  readonly requesterUserId: string;
}

export const commitOrganizationGroupPolicy =
  createIdentityBoundDatabaseWorkflowService<
    CommitOrganizationGroupPolicyServiceInput,
    CommitOrganizationGroupPolicyResult
  >(async (db, input, identityTrustDomain) =>
    runCommitOrganizationGroupPolicyWorkflow(
      db,
      {
        ...input,
        request: await rebuildCommitMemberEnvelopes(db, input.request),
      },
      identityTrustDomain,
    ),
  );
