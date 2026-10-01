import { expect, test } from "bun:test";
import {
  type ContainerKekKeyringEntry,
  computeContainerKekMaterialId,
  normalizeContainerKekKeyring,
  openContainerKekKeyring,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createChildContainerProjection } from "../../../../test/helpers/projectionHierarchy";
import { rekeyRemoteContainer } from "./rekeyRemote";

const CHILD_ID = "lineage-child";

/**
 * A child rotated once (epoch 1 -> 2), then served with its epoch-1 manifest
 * under the root's KEK instead of its own: the pooled lineage still verifies,
 * but the child KEK's history no longer names the epoch-1 id (#2365 finding
 * 32).
 */
async function relocatedChildHistory() {
  const parent = await createParentProjection();
  const child = await createChildContainerProjection({
    containerId: CHILD_ID,
    parent,
    parentProjection: parent.projection,
  });
  const database = await createTestExecSql("rekey-override-lineage");
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
  return { child, database, epoch1Id, epoch2Kek, parent, projection };
}

async function repairWithOverride(
  scenario: Awaited<ReturnType<typeof relocatedChildHistory>>,
  keyringEntriesOverride: readonly ContainerKekKeyringEntry[],
) {
  const submitted: ContainerMutationRequest[] = [];
  const repair = rekeyRemoteContainer({
    reportSecurityIncident: async () => {},
    apiClient: {
      reciteContainer: async () => null,
      getContainerWriterProjection: async () => scenario.projection,
      rekeyContainer: async (_containerId, request) => {
        submitted.push(request);
        return createMutationResponseFromRequest(
          request,
          scenario.projection.containerKeks.at(-1),
        );
      },
    },
    author: scenario.parent.author,
    containerId: CHILD_ID,
    execSql: scenario.database.execSql,
    keyringEntriesOverride,
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(
      scenario.parent,
    ),
    targetSecretKey: scenario.parent.secretKey,
  });
  return { repair, submitted };
}

test("a rebuilt override cannot seal an epoch id outside the signed lineage", async () => {
  const scenario = await relocatedChildHistory();
  // Server-chosen material under an invented id: self-consistent, so the
  // per-entry material check passes.
  const forgedKey = crypto.getRandomValues(new Uint8Array(32));
  const forgedId = await computeContainerKekMaterialId({
    containerId: CHILD_ID,
    keyEpoch: 1,
    keyMaterial: forgedKey,
  });
  const { repair, submitted } = await repairWithOverride(scenario, [
    { containerKeyEpochId: forgedId, keyMaterial: forgedKey },
  ]);
  await expect(repair).rejects.toMatchObject({
    code: "object_mismatch",
    message: expect.stringContaining("outside the container's signed lineage"),
  });
  expect(submitted).toEqual([]);
});

test("an honest rebuilt override seals across relocated history", async () => {
  const scenario = await relocatedChildHistory();
  const { repair, submitted } = await repairWithOverride(scenario, [
    {
      containerKeyEpochId: scenario.epoch1Id,
      keyMaterial: scenario.child.containerKey,
    },
  ]);
  const repaired = await repair;
  const keyring = repaired?.response.containerKek.keyring;
  if (!repaired || !keyring) throw new Error("Expected a sealed repair");
  expect(submitted).toHaveLength(1);
  const entries = await openContainerKekKeyring({
    keyEpoch: 3,
    keyring: normalizeContainerKekKeyring(keyring),
    successorContainerKey: repaired.containerKey,
  });
  expect(entries.map((entry) => entry.containerKeyEpochId)).toEqual([
    scenario.epoch1Id,
    scenario.epoch2Kek.containerKeyEpochId,
  ]);
});
