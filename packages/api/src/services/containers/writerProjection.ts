import { omitProjectionHistory } from "@tearleads/crypto";
import { encodeContainerWriterProjection } from "@tearleads/validators/response";
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
  // Each distinct manifest bundle travels once; every position cites it by hash.
  return encodeContainerWriterProjection(
    omitProjectionHistory(
      projection,
      parseProjectionHistoryHints(input.historyPrefixes ?? "[]") ?? [],
    ),
  );
}
