import {
  type PutPrincipalPolicyInput,
  type PutPrincipalPolicyResult,
  runPutPrincipalPolicyWorkflow,
} from "../../workflows/principals/putPrincipalPolicy";
import { createDatabaseWorkflowService } from "../databaseWorkflowService";

export const putPrincipalPolicy = createDatabaseWorkflowService<
  PutPrincipalPolicyInput,
  PutPrincipalPolicyResult
>(runPutPrincipalPolicyWorkflow);
