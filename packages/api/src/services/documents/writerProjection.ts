import { encodeDocumentWriterProjection } from "@tearleads/validators/response";
import { parseKnownManifestHints } from "@tearleads/validators/util";
import {
  DocumentWriterProjectionError,
  runDocumentWriterProjectionWorkflow,
} from "../../workflows/documents/writerProjection";
import { heldKekLevelDigests } from "../containers/heldKekLevelDigests";
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
  const hints = parseKnownManifestHints(input.knownManifests ?? "");
  return encodeDocumentWriterProjection(
    projection,
    new Set(hints?.manifests),
    await heldKekLevelDigests(
      projection.authorizingContainerPaths,
      hints?.kekLevels ?? [],
    ),
  );
}
