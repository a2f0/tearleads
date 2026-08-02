import { expect, test } from "bun:test";
import {
  computeContainerKekMaterialId,
  computeContainerKeyEpochHash,
  computeDocumentContentKeyTargetHash,
} from "@tearleads/crypto";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { unwrapContainerKekPath } from "../../data/documents/shared/containerKekPath";
import { readContainerKeyEpoch } from "../../data/keyingProjectionVerification/readers";
import { buildMaterializedDocumentSyncPlan } from "./sync";

async function expectDamagedPredecessorReadToFail(
  includeHistoricalManifest: boolean,
): Promise<void> {
  const fixture = await createMaterializedSyncFixture();
  const projection = structuredClone(
    fixture.writerProjection.authorizingContainerPaths[0],
  );
  const currentKek = projection?.containerKeks[0];
  const currentManifest = projection?.path[0];
  if (!projection || !currentKek || !currentManifest) {
    throw new Error("Expected an authorizing projection fixture");
  }
  const currentKey = (
    await unwrapContainerKekPath({
      projection,
      secretKey: fixture.secretKey,
      trustedLocalProjection: true,
    })
  ).get(currentKek.containerKeyEpochId);
  if (!currentKey) {
    throw new Error("Expected the current container KEK fixture");
  }

  const containerKeyEpoch = currentKek.containerKeyEpoch + 1;
  const containerKeyEpochId = await computeContainerKekMaterialId({
    containerId: currentKek.containerId,
    keyEpoch: containerKeyEpoch,
    keyMaterial: currentKey,
  });
  const keyEpoch = {
    ...readContainerKeyEpoch(currentKek.keyEpoch, "current key epoch"),
    id: containerKeyEpochId,
    keyEpoch: containerKeyEpoch,
  };
  projection.containerKeks = [
    {
      ...currentKek,
      containerKeyEpoch,
      containerKeyEpochId,
      containerManifestHistory: includeHistoricalManifest
        ? [
            {
              ...currentManifest,
              state: {
                ...currentManifest.state,
                containerKeyEpochId: currentKek.containerKeyEpochId,
              },
            },
          ]
        : [],
      keyEpoch: keyEpoch as unknown as Record<string, unknown>,
      keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
      keyring: null,
      historicalKeyEpochs: [],
      wraps: currentKek.wraps.map((wrap) => ({
        ...wrap,
        containerKeyEpochId,
      })),
    },
  ];
  const currentTarget = {
    containerId: currentKek.containerId,
    containerKeyEpoch,
    containerKeyEpochId,
    containerManifestHash: currentManifest.manifestHash,
  };

  await expect(
    buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      localVersionVector: null,
      pendingUpdates: [],
      signedAt: "2026-07-26T00:00:00.000Z",
      targetSecretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: {
        ...fixture.writerProjection,
        authorizingContainerPaths: [projection],
        contentKeyBundleStale: true,
        documentKekTargets: {
          ...fixture.writerProjection.documentKekTargets,
          documentKeyTargetHash: await computeDocumentContentKeyTargetHash([
            currentTarget,
          ]),
          linkedContainerKeyEpochIds: [containerKeyEpochId],
          linkedContainerManifestHashes: [currentManifest.manifestHash],
          targets: [currentTarget],
        },
      },
    }),
  ).rejects.toThrow("predecessor chain is incomplete");
}

test("damaged predecessor history fails a stale read that needs the missing epoch", async () => {
  await expectDamagedPredecessorReadToFail(true);
});

test("fully truncated predecessor metadata preserves the history-integrity error", async () => {
  await expectDamagedPredecessorReadToFail(false);
});
