import { bytesToBase64 } from "@tearleads/encoding";
import {
  type createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  getTextValue,
} from "@tearleads/loro";
import { createMockApiClient } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { DocumentsRuntime } from "../types";
import type { createRemoteHistoryFixture } from "./documentStore.testFixtures";

/** Persist content as one durable checkpoint with no history tail. */
export async function persistFullHistoryDocument(input: {
  doc: Awaited<ReturnType<typeof createDocument>>;
  documentId: string;
  execSql: Parameters<typeof sqlDocumentsPersistence.saveDocument>[0];
  localId: string;
}): Promise<void> {
  const endVersion = encodeVersionVector(input.doc);
  await sqlDocumentsPersistence.replaceHistoryCheckpoint?.(input.execSql, {
    coveredTailIds: [],
    endVersionVector: endVersion,
    force: true,
    localId: input.localId,
    snapshot: bytesToBase64(exportFullHistorySnapshot(input.doc)),
  });
  await sqlDocumentsPersistence.saveDocument(input.execSql, {
    id: input.localId,
    containerId: "source-container",
    documentId: input.documentId,
    text: getTextValue(input.doc),
    snapshotEndVersion: endVersion,
    accessEpoch: 1,
    effectiveAccessLevel: "admin",
    pendingBaseVersion: endVersion,
  });
}

export function createRotationRecoveryRuntime(input: {
  fixture: Awaited<ReturnType<typeof createRemoteHistoryFixture>>;
  execSql: DocumentsRuntime["infra"]["execSql"];
  online?: boolean | undefined;
  requireRawHistory?: boolean | undefined;
  responseForRequest?:
    | ((
        request: DocumentSyncRequest,
        response: DocumentSyncResponse,
      ) => DocumentSyncResponse | Promise<DocumentSyncResponse>)
    | undefined;
  syncCalls?: { count: number } | undefined;
}): DocumentsRuntime {
  const { author, publicKey, response, secretKey, signingPublicKey } =
    input.fixture;
  const apiClient = createMockApiClient({
    getDocumentWriterProjection: async () => input.fixture.writerProjection,
    getUserIdentity: async () => null,
    syncDocument: async (
      documentId: string,
      request: DocumentSyncRequest,
    ): Promise<DocumentSyncResponse> => {
      if (
        input.requireRawHistory !== false &&
        (request.historyMode !== "raw" ||
          request.localVersionVector !== null ||
          request.outgoingUpdates.length !== 0)
      ) {
        throw new Error(
          "Rotation recovery must request complete read-only raw history",
        );
      }
      if (input.syncCalls) {
        input.syncCalls.count += 1;
      }
      const echoedUpdates = request.outgoingUpdates.map((update) => ({
        accessEpoch: 1,
        authorizationTargets: response.contentKeyBundle.targets.map(
          (target) => ({
            containerId: target.containerId,
            containerKeyEpoch: target.containerKeyEpoch,
            containerKeyEpochId: target.containerKeyEpochId,
            containerManifestHash: target.containerManifestHash,
          }),
        ),
        ...(update.checkpointKind === undefined
          ? {}
          : { checkpointKind: update.checkpointKind }),
        ...(update.checkpointPayloadKind === undefined
          ? {}
          : { checkpointPayloadKind: update.checkpointPayloadKind }),
        authorFingerprint: author.signerKeyFingerprint,
        createdAt: "2026-04-27T00:00:00.000Z",
        documentId,
        encryptedData: update.encryptedData,
        id: update.id,
        partialEndVersionVector: update.partialEndVersionVector,
        partialStartVersionVector: update.partialStartVersionVector,
        plaintextHash: update.plaintextHash,
        ...(update.sourceVersionVector === undefined
          ? {}
          : { sourceVersionVector: update.sourceVersionVector }),
        writeHeader: update.writeHeader,
      }));
      const defaultResponse = {
        ...response,
        acceptedOutgoingUpdateIds: request.outgoingUpdates.map(
          (update) => update.id,
        ),
        updates: [...response.updates, ...echoedUpdates],
      };
      return input.responseForRequest
        ? await input.responseForRequest(request, defaultResponse)
        : defaultResponse;
    },
  }) as unknown as DocumentsRuntime["apiClient"];

  return {
    apiClient,
    auth: {
      isAuthenticated: true,
      organizationId: author.organizationId,
      userId: author.signerUserId,
    },
    crypto: {
      encapsulationKeyPair: { publicKey, secretKey },
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair: {
        signingPrivateKey: author.signerPrivateKey,
        signingPublicKey,
      },
    },
    infra: {
      blobStore: null as never,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: input.execSql,
    },
    resolveTrustedUserIdentity: async (userId) =>
      userId === author.signerUserId
        ? createTestTrustedUserIdentity({
            encapsulationPublicKey: publicKey,
            signingKeyFingerprint: author.signerKeyFingerprint,
            signingPublicKey: signingPublicKey,
            userId,
          })
        : null,
    state: {
      containerId: "source-container",
      domainScope: createDomainScope(),
      events: [],
      online: input.online ?? true,
      peerScope: "rotation-recovery-restart",
    },
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  };
}
