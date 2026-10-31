import { encodeContainerWriterProjection } from "@tearleads/validators/response";
import { parseKnownManifestHints } from "@tearleads/validators/util";
import { runContainerWriterProjectionWorkflow } from "../../workflows/containers/writerProjection";
import { createDatabaseWorkflowService } from "../databaseWorkflowService";
import { heldKekLevelDigests } from "./heldKekLevelDigests";

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
  // travels once, and the bundles and KEK levels the request holds are cited
  // but not sent.
  const hints = parseKnownManifestHints(input.knownManifests ?? "");
  return encodeContainerWriterProjection(
    projection,
    new Set(hints?.manifests),
    await heldKekLevelDigests([projection], hints?.kekLevels ?? []),
  );
}
