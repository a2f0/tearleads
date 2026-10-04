import { omitProjectionHistory } from "@tearleads/crypto";
import { parseProjectionHistoryHints } from "@tearleads/validators/util";
import { runContainerWriterProjectionWorkflow } from "../../workflows/containers/writerProjection";
import { createDatabaseWorkflowService } from "../databaseWorkflowService";

export {
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
} from "../../workflows/containers/writerProjection";

const getFullProjection = createDatabaseWorkflowService(
  runContainerWriterProjectionWorkflow,
);
export async function getContainerWriterProjection(
  runtime: Parameters<typeof getFullProjection>[0],
  input: Parameters<typeof getFullProjection>[1] & {
    readonly historyPrefixes?: string | undefined;
  },
) {
  const projection = await getFullProjection(runtime, input);
  return omitProjectionHistory(
    projection,
    parseProjectionHistoryHints(input.historyPrefixes ?? "[]") ?? [],
  );
}
