import { runContainerReplacementAuthorizationsWorkflow } from "../../workflows/containers/replacementAuthorizations";
import { createDatabaseWorkflowService } from "../databaseWorkflowService";

export const getContainerReplacementAuthorizations =
  createDatabaseWorkflowService(runContainerReplacementAuthorizationsWorkflow);
