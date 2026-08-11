import type { CommitOrganizationGroupPolicyRequest } from "@tearleads/validators/request";
import {
  type CommitOrganizationGroupPolicyResult,
  type PutPrincipalPolicyInput,
  type PutPrincipalPolicyResult,
  runCommitOrganizationGroupPolicyWorkflow,
  runPutPrincipalPolicyWorkflow,
} from "../../workflows/principals/putPrincipalPolicy";
import { createDatabaseWorkflowService } from "../databaseWorkflowService";

export const putPrincipalPolicy = createDatabaseWorkflowService<
  PutPrincipalPolicyInput,
  PutPrincipalPolicyResult
>(runPutPrincipalPolicyWorkflow);

interface CommitOrganizationGroupPolicyServiceInput {
  readonly groupId: string;
  readonly organizationId: string;
  readonly request: CommitOrganizationGroupPolicyRequest;
  readonly requesterUserId: string;
}

export const commitOrganizationGroupPolicy = createDatabaseWorkflowService<
  CommitOrganizationGroupPolicyServiceInput,
  CommitOrganizationGroupPolicyResult
>(runCommitOrganizationGroupPolicyWorkflow);
