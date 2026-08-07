import { runContainerKekLogWorkflow } from "../../workflows/containers/kekLog";
import { createDatabaseWorkflowService } from "../databaseWorkflowService";

export const getContainerKekLog = createDatabaseWorkflowService(
  runContainerKekLogWorkflow,
);
