import {
  type ContainerKekKeyringEntry,
  computeContainerKekMaterialId,
  sealContainerKekKeyring,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { rekeyRemoteContainer } from "../../src/workflows/containers/child/rekeyRemote";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "./containerFixtures";
import { createChildContainerProjection } from "./projectionHierarchy";

export const CHILD_ID = "lineage-child";

/**
 * A child rotated once (epoch 1 -> 2), then served with its epoch-1 manifest
 * under the root's KEK instead of its own: the pooled lineage still verifies,
 * but the child KEK's history no longer names the epoch-1 id (#2365 finding
 * 32).
 */
export async function relocatedChildHistory() {
  const parent = await createParentProjection();
  const child = await createChildContainerProjection({
    containerId: CHILD_ID,
    parent,
    parentProjection: parent.projection,
  });
  const database = await createTestExecSql("relocated-lineage");
  const rekeyed = await rekeyRemoteContainer({
    reportSecurityIncident: async () => {},
    apiClient: {
      reciteContainer: async () => null,
      getContainerWriterProjection: async () => child.projection,
      rekeyContainer: async (_containerId, request) =>
        createMutationResponseFromRequest(
          request,
          child.projection.containerKeks.at(-1),
        ),
    },
    author: parent.author,
    containerId: CHILD_ID,
    execSql: database.execSql,
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    targetSecretKey: parent.secretKey,
  });
  const rootKek = child.projection.containerKeks[0];
  const epoch1Id = child.projection.containerKeks.at(-1)?.containerKeyEpochId;
  if (!rekeyed || !rootKek || !epoch1Id) {
    throw new Error("Expected a rotated child under a root KEK");
  }
  const epoch2Kek = rekeyed.response.containerKek;
  const projection: ContainerWriterProjectionResponse = {
    ...child.projection,
    path: [
      ...child.projection.path.slice(0, -1),
      rekeyed.response.accessManifest,
    ],
    containerKeks: [
      {
        ...rootKek,
        containerManifestHistory: [
          ...rootKek.containerManifestHistory,
          child.bundle,
        ],
      },
      {
        ...epoch2Kek,
        containerManifestHistory: epoch2Kek.containerManifestHistory.filter(
          (bundle) => bundle.manifestHash !== child.bundle.manifestHash,
        ),
      },
    ],
  };
  return {
    child,
    database,
    epoch1Id,
    epoch2Key: rekeyed.containerKey,
    epoch2Kek,
    parent,
    projection,
  };
}

export async function forgedEpoch1Entry(): Promise<ContainerKekKeyringEntry> {
  // Server-chosen material under an invented id: self-consistent, so the
  // per-entry material check passes.
  const keyMaterial = crypto.getRandomValues(new Uint8Array(32));
  const containerKeyEpochId = await computeContainerKekMaterialId({
    containerId: CHILD_ID,
    keyEpoch: 1,
    keyMaterial,
  });
  return { containerKeyEpochId, keyMaterial };
}

export type RelocatedChildHistory = Awaited<
  ReturnType<typeof relocatedChildHistory>
>;

/**
 * The relocated projection, with the child's served keyring replaced by one
 * sealed under its epoch-2 key around a forged epoch-1 entry. No signed event
 * commits to it, so a reader records a history failure while the current KEK
 * still unwraps, and the rotation reaches its re-seal.
 */
export async function servingForgedKeyring(
  scenario: RelocatedChildHistory,
): Promise<ContainerWriterProjectionResponse> {
  const [rootKek, childKek] = scenario.projection.containerKeks;
  if (!rootKek || !childKek) throw new Error("Expected root and child KEKs");
  const forgedKeyring = await sealContainerKekKeyring({
    containerId: CHILD_ID,
    entries: [await forgedEpoch1Entry()],
    keyEpoch: 2,
    successorContainerKey: scenario.epoch2Key,
    successorContainerKeyEpochId: childKek.containerKeyEpochId,
  });
  return {
    ...scenario.projection,
    containerKeks: [
      rootKek,
      {
        ...childKek,
        keyring: forgedKeyring,
      },
    ],
  };
}
