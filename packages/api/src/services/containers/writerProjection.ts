import { runContainerWriterProjectionWorkflow } from "../../workflows/containers/writerProjection";
import { createDatabaseWorkflowService } from "../databaseWorkflowService";

export {
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
} from "../../workflows/containers/writerProjection";

export const getContainerWriterProjection = createDatabaseWorkflowService(
  runContainerWriterProjectionWorkflow,
);
