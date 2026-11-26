import { expect } from "bun:test";
import { computeDocumentContentKeyTargetHash } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { asContainerMutationFixture } from "@tearleads/test-utils";
import {
  buildRotatedDocumentContentKeyBundle,
  collectContainerKeksForDocumentSync,
} from "../../../src/data/documents/shared/projection";
import { sqlDocumentsPersistence } from "../../../src/data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../src/data/sqlite/sqlSchema";
import type { createRemoteHistoryFixture } from "../../../src/stores/documents/documentStore/documentStore.testFixtures";
import { buildMaterializedDocumentSyncPlan } from "../../../src/workflows/documents/syncPlan/syncPlanMaterial";
import { createMutationResponseFromRequest } from "../data/containerFixtures";
import {
  createPendingUpdateRecord,
  createSyncResponse,
} from "../data/documentFixtures";
import { createContainerMutationServiceFixture } from "./containerMutationServiceFixture";
import { persistFullHistoryDocument } from "./rotationRecoveryRuntime";

type RemoteHistoryFixture = Awaited<
  ReturnType<typeof createRemoteHistoryFixture>
>;
type FixtureDocument = Awaited<ReturnType<typeof createDocument>>;

/**
 * A `rotate_baseline` checkpoint of `document`, signed by the fixture's
 * author, as the server would serve it.
 */
export async function createRotationBaselineUpdate(
  fixture: RemoteHistoryFixture,
  updateId: string,
  document: FixtureDocument,
) {
  const snapshot = exportFullHistorySnapshot(document);
  const vectors = getUpdateVersionVectors(snapshot);
  const plan = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    localVersionVector: null,
    pendingUpdates: [
      createPendingUpdateRecord({
        id: updateId,
        sourceVersionVector: vectors.partialEndVersionVector,
        updateData: bytesToBase64(snapshot),
        ...vectors,
      }),
    ],
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.writerProjection,
  });
  return {
    response: await createSyncResponse(plan.plan, {
      acceptedOutgoingUpdateIds: [],
    }),
    snapshot,
    vectors,
  };
}

/**
 * A rotation baseline whose snapshot reuses the honest writer's operation
 * ids, at the honest history's version, with other content.
 */
export async function createForgedRotationBaseline(
  fixture: RemoteHistoryFixture,
  updateId: string,
) {
  const forgedDocument = await createDocument("rotation-recovery-remote");
  forgedDocument.getText("text").update("forged value");
  forgedDocument.commit();
  forgedDocument.getText("text").update("forged value hidden!!");
  forgedDocument.commit();
  expect(encodeVersionVector(forgedDocument)).toBe(
    encodeVersionVector(fixture.remoteDocument),
  );
  return {
    document: forgedDocument,
    ...(await createRotationBaselineUpdate(fixture, updateId, forgedDocument)),
  };
}

/**
 * The fixture after a content-key rotation whose retained predecessor bundle
 * the server serves malformed: one target's wrapped key is not a key.
 */
export async function createMalformedHistoricalBundleFixture(
  fixture: RemoteHistoryFixture,
) {
  const collectedKeks = await collectContainerKeksForDocumentSync({
    secretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.writerProjection,
  });
  const currentContentKeyBundle = await buildRotatedDocumentContentKeyBundle({
    containerKeksByEpochId: collectedKeks.keksByEpochId,
    contentKey: crypto.getRandomValues(new Uint8Array(32)),
    writerProjection: fixture.writerProjection,
  });
  const [historicalTarget, ...otherHistoricalTargets] =
    fixture.writerProjection.contentKeyBundle.targets;
  if (!historicalTarget) {
    throw new Error("Expected historical content-key target");
  }
  const malformedHistoricalBundle = {
    ...fixture.writerProjection.contentKeyBundle,
    targets: [
      {
        ...historicalTarget,
        wrappedKey: bytesToBase64(new Uint8Array([1, 2, 3])),
      },
      ...otherHistoricalTargets,
    ],
  };
  return {
    ...fixture,
    response: {
      ...fixture.response,
      contentKeyBundles: [malformedHistoricalBundle],
    },
    writerProjection: {
      ...fixture.writerProjection,
      contentKeyBundle: currentContentKeyBundle,
    },
  };
}

/**
 * Persists the fixture's remote document as `localId`, then rekeys its
 * container and rotates its content key so that the predecessor epoch's
 * bundle is served and verified but its key is out of this device's reach:
 * the current container KEK carries no keyring.
 */
export async function createUnreachableEpochFixture(input: {
  readonly execSql: ExecSql;
  readonly fixture: RemoteHistoryFixture;
  readonly localId: string;
}) {
  const { execSql, fixture, localId } = input;
  await persistFullHistoryDocument({
    doc: fixture.remoteDocument,
    documentId: fixture.writerProjection.documentId,
    execSql,
    localId,
  });
  const stored = await sqlDocumentsPersistence.loadDocument(execSql, localId);
  if (!stored) throw new Error("Expected a persisted document fixture");
  await sqlDocumentsPersistence.saveDocument(execSql, {
    ...stored,
    contentKeyBundle: JSON.stringify(fixture.writerProjection.contentKeyBundle),
    documentKekTargets: JSON.stringify(
      fixture.writerProjection.documentKekTargets,
    ),
    documentManifestBundle: JSON.stringify(
      fixture.writerProjection.documentManifest,
    ),
  });
  const previousKek = fixture.projection.containerKeks.at(-1);
  if (!previousKek) throw new Error("Expected a container KEK fixture");
  const rekeyed = await createContainerMutationServiceFixture({
    reportSecurityIncident: async () => {},
    api: {
      reciteContainer: async () => null,
      getContainerWriterProjection: async () => fixture.projection,
      rekeyContainer: async (_containerId, request) =>
        createMutationResponseFromRequest(request, previousKek),
    },
    execSql,
    encapsulationSecretKey: fixture.secretKey,
  }).rekeyRemoteContainer({
    author: fixture.author,
    containerId: fixture.projection.containerId,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
  });
  if (!rekeyed) throw new Error("Expected the container rekey to succeed");
  const mutation = asContainerMutationFixture(rekeyed.response);
  const currentTarget = {
    containerId: mutation.containerKek.containerId,
    containerKeyEpoch: mutation.containerKek.containerKeyEpoch,
    containerKeyEpochId: mutation.containerKek.containerKeyEpochId,
    containerManifestHash: mutation.accessManifest.manifestHash,
  };
  const documentKekTargets = {
    ...fixture.writerProjection.documentKekTargets,
    documentKeyTargetHash: await computeDocumentContentKeyTargetHash([
      currentTarget,
    ]),
    linkedContainerKeyEpochIds: [currentTarget.containerKeyEpochId],
    linkedContainerManifestHashes: [currentTarget.containerManifestHash],
    targets: [currentTarget],
  };
  const rotatedProjection = {
    ...fixture.writerProjection,
    authorizingContainerPaths: [
      {
        ...fixture.projection,
        containerKeks: [
          {
            ...mutation.containerKek,
            containerManifestHistory: [...fixture.projection.path],
            keyring: null,
          },
        ],
        path: [mutation.accessManifest],
      },
    ],
    documentKekTargets,
  };
  const currentContentKeyBundle = await buildRotatedDocumentContentKeyBundle({
    containerKeksByEpochId: new Map([
      [currentTarget.containerKeyEpochId, rekeyed.containerKey],
    ]),
    contentKey: crypto.getRandomValues(new Uint8Array(32)),
    writerProjection: rotatedProjection,
  });
  return {
    ...fixture,
    response: {
      ...fixture.response,
      contentKeyBundle: currentContentKeyBundle,
      contentKeyBundles: [fixture.writerProjection.contentKeyBundle],
      documentKekTargets,
    },
    writerProjection: {
      ...rotatedProjection,
      contentKeyBundle: currentContentKeyBundle,
    },
  };
}
