import { expect, test } from "bun:test";
import {
  type ContainerKekKeyringEntry,
  computeContainerKekMaterialId,
  normalizeContainerKekKeyring,
  openContainerKekKeyring,
  sealContainerKekKeyring,
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
import {
  manifestHistoryEpochIds,
  unwrapKeyringContainerKeksAtIndex,
} from "../../../data/documents/shared/containerKekPathHistory";
import { verifyContainerDestinationProjection } from "../../../data/keyingProjectionVerification/containerDestinationVerification";
import { verifyKeyringEntriesForSeal } from "./moveRotation";
import { rekeyRemoteContainer } from "./rekeyRemote";
import { resolveRotationContext } from "./rotationContext";

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

async function forgedEpoch1Entry(): Promise<ContainerKekKeyringEntry> {
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
  const { repair, submitted } = await repairWithOverride(scenario, [
    await forgedEpoch1Entry(),
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

test("an override that omits a lineage epoch is refused as stale", async () => {
  const scenario = await relocatedChildHistory();
  const { repair, submitted } = await repairWithOverride(scenario, []);
  await expect(repair).rejects.toMatchObject({
    code: "missing_dependency",
    message: expect.stringContaining("omits an epoch"),
  });
  expect(submitted).toEqual([]);
});

test("a reader rejects a keyring whose real epoch id was served elsewhere", async () => {
  const scenario = await relocatedChildHistory();
  const { verifiedByHash } = await verifyContainerDestinationProjection({
    execSql: scenario.database.execSql,
    projection: scenario.projection,
    resolveUserKey: createParentProjectionUserKeyResolver(scenario.parent),
  });
  const kek = scenario.projection.containerKeks[1];
  const currentManifest = scenario.projection.path[1];
  if (!kek || !currentManifest) throw new Error("Expected the child KEK");
  const forgedKeyring = await sealContainerKekKeyring({
    containerId: CHILD_ID,
    entries: [await forgedEpoch1Entry()],
    keyEpoch: 2,
    successorContainerKey: scenario.epoch2Key,
    successorContainerKeyEpochId: kek.containerKeyEpochId,
  });
  const read = (verified: typeof verifiedByHash | undefined) =>
    unwrapKeyringContainerKeksAtIndex({
      currentManifest,
      index: 1,
      kek: { ...kek, keyring: forgedKeyring as unknown as typeof kek.keyring },
      keksByEpochId: new Map(),
      successorKeyMaterial: scenario.epoch2Key,
      verifiedByHash: verified,
      verifyKeyringCommitment: false,
    });
  // The KEK's own history alone no longer names the real epoch-1 id.
  expect(manifestHistoryEpochIds(kek).has(scenario.epoch1Id)).toBe(false);
  await expect(read(undefined)).resolves.toBeUndefined();
  await expect(read(verifiedByHash)).rejects.toMatchObject({
    code: "missing_dependency",
  });
});

test("a rotation anchors its re-seal to the lineage served elsewhere", async () => {
  const scenario = await relocatedChildHistory();
  const context = await resolveRotationContext(
    {
      author: scenario.parent.author,
      execSql: scenario.database.execSql,
      previousProjection: scenario.projection,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(
        scenario.parent,
      ),
      targetSecretKey: scenario.parent.secretKey,
    },
    "rekey",
  );
  expect([...context.signedEpochIds]).toEqual([scenario.epoch1Id]);
  await expect(
    verifyKeyringEntriesForSeal(
      CHILD_ID,
      [await forgedEpoch1Entry()],
      context.target.kek,
      context.signedEpochIds,
    ),
  ).rejects.toThrow("omits an epoch its manifest history commits to");
});
