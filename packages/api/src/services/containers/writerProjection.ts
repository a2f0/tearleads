import { encodeContainerWriterProjection } from "@tearleads/validators/response";
import { parseKnownManifestHints } from "@tearleads/validators/util";
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
    readonly knownManifests?: string | undefined;
  },
) {
  const projection = await getFullProjection(runtime, input);
  // Built, authorized and verified as for any reader; each distinct bundle
  // travels once, and the bundles the request holds are cited but not sent.
  return encodeContainerWriterProjection(
    projection,
    new Set(parseKnownManifestHints(input.knownManifests ?? "") ?? []),
  );
}
