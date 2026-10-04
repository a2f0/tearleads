import { omitProjectionHistory } from "@tearleads/crypto";
import { parseProjectionHistoryHints } from "@tearleads/validators/util";
import {
  DocumentWriterProjectionError,
  runDocumentWriterProjectionWorkflow,
} from "../../workflows/documents/writerProjection";
import { createDatabaseWorkflowService } from "../databaseWorkflowService";

export { DocumentWriterProjectionError };

const getFullProjection = createDatabaseWorkflowService(
  runDocumentWriterProjectionWorkflow,
);
export async function getDocumentWriterProjection(
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
