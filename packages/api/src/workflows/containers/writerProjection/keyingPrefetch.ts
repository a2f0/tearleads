import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import {
  getContainerKeyEpochsWithKeyrings,
  listContainerKeyWrapsByEpochId,
} from "../../../access/read/containerKekStore";
import { prefetchContainerManifestHistory } from "./accessPaths";
import type { ContainerWriterProjectionContext } from "./types";

/** Path length is bounded before key material is loaded; no cross-request reuse. */
export async function prefetchContainerKeyingPath(
  context: ContainerWriterProjectionContext,
  path: readonly VerifiedContainerAccessManifest[],
): Promise<void> {
  const epochIds = [
    ...new Set(
      path.flatMap((manifest) =>
        manifest.state.containerKeyEpochId
          ? [manifest.state.containerKeyEpochId]
          : [],
      ),
    ),
  ];
  const epochs = await getContainerKeyEpochsWithKeyrings(
    epochIds.filter((id) => !context.keyEpochById.has(id)),
    context.executor,
  );
  for (const [id, epoch] of epochs) context.keyEpochById.set(id, epoch);
  const wraps = await listContainerKeyWrapsByEpochId(
    epochIds.filter((id) => !context.keyWrapsByEpochId.has(id)),
    context.executor,
  );
  for (const [id, rows] of wraps) context.keyWrapsByEpochId.set(id, rows);
  await prefetchContainerManifestHistory(
    context,
    path.map((manifest) => manifest.state.containerId),
  );
}
