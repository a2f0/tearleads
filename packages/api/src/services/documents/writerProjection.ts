import {
  DocumentWriterProjectionError,
  runDocumentWriterProjectionWorkflow,
} from "../../workflows/documents/writerProjection";
import { createDatabaseWorkflowService } from "../databaseWorkflowService";

export { DocumentWriterProjectionError };

export const getDocumentWriterProjection = createDatabaseWorkflowService(
  runDocumentWriterProjectionWorkflow,
);
