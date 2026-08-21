import { expect, test } from "bun:test";
import {
  computeContainerKekMaterialId,
  computeContainerKeyEpochHash,
  computeDocumentContentKeyTargetHash,
  sealContainerKekKeyring,
} from "@symcrypt/crypto";
import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import {
  createMaterializedSyncFixture,
  createUserContainerWrap,
} from "../../../test/helpers/documentFixtures";
import { unwrapContainerKekPath } from "../../data/documents/shared/containerKekPath";
import { DocumentHistoryUnavailableError } from "../../data/documents/shared/projectionContentKeys";
import { readContainerKeyEpoch } from "../../data/keyingProjectionVerification/readers";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

/**
 * Rotates the fixture container to epoch 2 with damaged history — either a
 * keyring whose sealed bytes were corrupted (with the historical manifest
 * still attributing the missing epoch) or no keyring at all — and asserts a
 * stale read that needs the epoch-1 KEK fails closed with the history
 * integrity error while current-epoch access keeps working.
 */
async function expectDamagedPredecessorReadToFail(
  damagedKeyring: boolean,
): Promise<Error> {
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

  const successorKey = crypto.getRandomValues(new Uint8Array(32));
  const containerKeyEpoch = currentKek.containerKeyEpoch + 1;
  const containerKeyEpochId = await computeContainerKekMaterialId({
    containerId: currentKek.containerId,
    keyEpoch: containerKeyEpoch,
    keyMaterial: successorKey,
  });
  const keyEpoch = {
    ...readContainerKeyEpoch(currentKek.keyEpoch, "current key epoch"),
    id: containerKeyEpochId,
    keyEpoch: containerKeyEpoch,
  };
  let keyring: (typeof currentKek)["keyring"] = null;
  if (damagedKeyring) {
    const sealedKeyring = await sealContainerKekKeyring({
      containerId: currentKek.containerId,
      entries: [
        {
          containerKeyEpochId: currentKek.containerKeyEpochId,
          keyMaterial: currentKey,
        },
      ],
      keyEpoch: containerKeyEpoch,
      successorContainerKey: successorKey,
      successorContainerKeyEpochId: containerKeyEpochId,
    });
    const tamperedSealed = base64ToBytes(sealedKeyring.sealed);
    tamperedSealed[8] = (tamperedSealed[8] ?? 0) ^ 0xff;
    keyring = { ...sealedKeyring, sealed: bytesToBase64(tamperedSealed) };
  }
  projection.containerKeks = [
    {
      ...currentKek,
      containerKeyEpoch,
      containerKeyEpochId,
      containerManifestHistory: damagedKeyring
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
      keyring,
      wraps: [
        await createUserContainerWrap({
          containerKeyEpochId,
          containerKek: successorKey,
          publicKey: fixture.publicKey,
          userId: fixture.author.signerUserId,
          wrapManifestHash: currentManifest.manifestHash,
        }),
      ],
    },
  ];

  // Damaged history must not take the current epoch down with it.
  const rotatedKeks = await unwrapContainerKekPath({
    projection,
    secretKey: fixture.secretKey,
    trustedLocalProjection: true,
  });
  expect(Array.from(rotatedKeks.get(containerKeyEpochId) ?? [])).toEqual(
    Array.from(successorKey),
  );
  expect(rotatedKeks.has(currentKek.containerKeyEpochId)).toBe(false);

  const currentTarget = {
    containerId: currentKek.containerId,
    containerKeyEpoch,
    containerKeyEpochId,
    containerManifestHash: currentManifest.manifestHash,
  };
  const error = await buildMaterializedDocumentSyncPlan({
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
  }).then(
    () => {
      throw new Error("Expected the stale history read to fail");
    },
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(DocumentHistoryUnavailableError);
  return error as Error;
}

test("damaged predecessor history fails a stale read that needs the missing epoch", async () => {
  const error = await expectDamagedPredecessorReadToFail(true);
  expect(
    (error as DocumentHistoryUnavailableError).historyCause,
  ).toBeInstanceOf(Error);
});

test("fully truncated predecessor metadata preserves the history-integrity error", async () => {
  const error = await expectDamagedPredecessorReadToFail(false);
  expect(error.message).toContain("keyring is missing");
});
