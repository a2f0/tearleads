import { expect, test } from "bun:test";
import { computeDocumentContentKeyTargetHash } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMutationResponseFromRequest } from "../../../../test/helpers/containerFixtures";
import { buildRotatedDocumentContentKeyBundle } from "../../../data/documents/shared/projection";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { rekeyRemoteContainer } from "../../../workflows/containers/child/rekey";
import { DocumentRawHistoryUnavailableError } from "../../../workflows/documents";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "./documentStore.testFixtures";
import { ensureDocumentStoreReady } from "./initialization";
import { assertDocumentStoreCanRotateContentKey } from "./rotation";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "./rotationRecoveryHelpers.test";
import { createDocumentStoreState } from "./state";

test("raw rotation reports unavailable predecessor history after its persisted-state submit", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-raw-history-missing-predecessor",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-raw-history-missing-predecessor-local";
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
      contentKeyBundle: JSON.stringify(
        fixture.writerProjection.contentKeyBundle,
      ),
      documentKekTargets: JSON.stringify(
        fixture.writerProjection.documentKekTargets,
      ),
      documentManifestBundle: JSON.stringify(
        fixture.writerProjection.documentManifest,
      ),
    });
    const originalRecord = await sqlDocumentsPersistence.loadDocument(
      execSql,
      localId,
    );

    const previousKek = fixture.projection.containerKeks.at(-1);
    if (!previousKek) throw new Error("Expected a container KEK fixture");
    const rekeyed = await rekeyRemoteContainer({
      apiClient: {
        getContainerWriterProjection: async () => fixture.projection,
        rekeyContainer: async (_containerId, request) =>
          createMutationResponseFromRequest(request, previousKek),
      },
      author: fixture.author,
      containerId: fixture.projection.containerId,
      execSql,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetSecretKey: fixture.secretKey,
    });
    if (!rekeyed) throw new Error("Expected the container rekey to succeed");
    const currentTarget = {
      containerId: rekeyed.response.containerKek.containerId,
      containerKeyEpoch: rekeyed.response.containerKek.containerKeyEpoch,
      containerKeyEpochId: rekeyed.response.containerKek.containerKeyEpochId,
      containerManifestHash: rekeyed.response.accessManifest.manifestHash,
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
    const currentContainerProjection = {
      ...fixture.projection,
      containerKeks: [
        {
          ...rekeyed.response.containerKek,
          containerManifestHistory: [...fixture.projection.path],
          keyring: null,
        },
      ],
      path: [rekeyed.response.accessManifest],
    };
    const rotatedProjection = {
      ...fixture.writerProjection,
      authorizingContainerPaths: [currentContainerProjection],
      documentKekTargets,
    };
    const currentContentKeyBundle = await buildRotatedDocumentContentKeyBundle({
      containerKeksByEpochId: new Map([
        [currentTarget.containerKeyEpochId, rekeyed.containerKey],
      ]),
      contentKey: crypto.getRandomValues(new Uint8Array(32)),
      writerProjection: rotatedProjection,
    });
    const currentFixture = {
      ...fixture,
      response: {
        ...fixture.response,
        contentKeyBundle: currentContentKeyBundle,
        contentKeyBundles: [
          fixture.writerProjection.contentKeyBundle,
          currentContentKeyBundle,
        ],
        documentKekTargets,
      },
      writerProjection: {
        ...rotatedProjection,
        contentKeyBundle: currentContentKeyBundle,
      },
    };
    const syncCalls = { count: 0 };
    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({
        execSql,
        fixture: currentFixture,
        syncCalls,
      }),
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    state.writerProjection = null;

    const error = await assertDocumentStoreCanRotateContentKey(state).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(DocumentRawHistoryUnavailableError);
    expect((error as DocumentRawHistoryUnavailableError).contentKeyEpoch).toBe(
      fixture.writerProjection.contentKeyBundle.contentKeyEpoch,
    );
    expect(syncCalls.count).toBe(1);
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, localId),
    ).toEqual(originalRecord);
  } finally {
    close();
  }
});
