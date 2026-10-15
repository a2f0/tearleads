import { encodeDocumentWriterProjection } from "@tearleads/validators/response";
import { parseKnownManifestHints } from "@tearleads/validators/util";
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
    readonly knownManifests?: string | undefined;
  },
) {
  const projection = await getFullProjection(runtime, input);
  // See getContainerWriterProjection.
  return encodeDocumentWriterProjection(
    projection,
    new Set(parseKnownManifestHints(input.knownManifests ?? "") ?? []),
  );
}
