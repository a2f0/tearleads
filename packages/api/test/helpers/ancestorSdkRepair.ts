import type { TestUser } from "@tearleads/bob-and-alice";
import {
  cacheReferencedPrincipalPolicies,
  syncRemoteDocument,
  validateDocumentSyncUpdateImports,
} from "@tearleads/client-sdk";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getTextValue,
  getUpdateVersionVectors,
  importUpdates,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  ContainerMutationRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import {
  type ContainerMutationResponse,
  isContainerMutationResponse,
} from "@tearleads/validators/response";
import { routeApp } from "../../src/routeApp";
import {
  createRouteSdkClient,
  documentAuthor,
  trustedResolver,
  writerResolver,
} from "./coldSdkRematerialization";

type AncestorSdkCommon = Pick<
  Parameters<typeof syncRemoteDocument>[0],
  | "author"
  | "execSql"
  | "resolveProjectionUserKey"
  | "targetSecretKey"
  | "warmReferencedPrincipalPolicies"
> & { apiClient: ReturnType<typeof createRouteSdkClient> };

interface AncestorSdkContext {
  readonly close: () => void;
  readonly execSql: Parameters<typeof syncRemoteDocument>[0]["execSql"];
  readonly common: AncestorSdkCommon;
  readonly postMutation: (
    path: string,
    request: ContainerMutationRequest,
  ) => Promise<ContainerMutationResponse>;
  readonly resolveTrustedUserIdentity: ReturnType<typeof trustedResolver>;
}

export async function createAncestorSdkContext(
  actor: TestUser,
  organizationId: string,
  ...otherUsers: TestUser[]
): Promise<AncestorSdkContext> {
  const database = await createTestExecSql(
    `ancestor-sdk-${crypto.randomUUID()}`,
  );
  const apiClient = createRouteSdkClient(actor.token);
  const resolveTrustedUserIdentity: ReturnType<typeof trustedResolver> =
    trustedResolver(actor, ...otherUsers);
  const postMutation = async (
    path: string,
    request: ContainerMutationRequest,
  ) => {
    const response = await routeApp.request(path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${actor.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
    const value: unknown = await response.json();
    if (!response.ok || !isContainerMutationResponse(value)) {
      throw new Error(`Container mutation failed: ${JSON.stringify(value)}`);
    }
    return value;
  };
  apiClient.createContainer = (request) => postMutation("/containers", request);
  apiClient.rekeyContainer = (id, request) =>
    postMutation(`/containers/${id}/rekey`, request);
  apiClient.shareContainer = (id, request) =>
    postMutation(`/containers/${id}/share`, request);
  const common: AncestorSdkCommon = {
    apiClient,
    author: documentAuthor(actor, organizationId),
    execSql: database.execSql,
    resolveProjectionUserKey: resolveTrustedUserIdentity,
    targetSecretKey: actor.kem.secretKey,
    warmReferencedPrincipalPolicies: (request: {
      organizationId: string;
      references: Parameters<
        typeof cacheReferencedPrincipalPolicies
      >[0]["references"];
    }) =>
      cacheReferencedPrincipalPolicies({
        execSql: database.execSql,
        getCurrentPrincipalPolicy: apiClient.getCurrentPrincipalPolicy,
        organizationId: request.organizationId,
        references: request.references,
        reportSecurityIncident: async () => undefined,
        resolveTrustedUserIdentity,
      }),
  };
  return { ...database, common, postMutation, resolveTrustedUserIdentity };
}

export async function editColdDocumentAfterAncestorRotation(input: {
  documentId: string;
  organizationId: string;
  owner: TestUser;
  writer: TestUser;
  loseFirstRepairResponse?: boolean;
  blockBeforeRepair?: boolean;
}) {
  const context = await createAncestorSdkContext(
    input.writer,
    input.organizationId,
    input.owner,
  );
  const document = await createDocument(`ancestor-edit-${crypto.randomUUID()}`);
  const requests: DocumentSyncRequest[] = [];
  const standaloneRepairs: string[] = [];
  const lostResponse = new Error("Simulated lost standalone repair response");
  let interrupted = false;
  let blocked = false;
  let repairsWhileBlocked: number | undefined;
  const rekey = context.common.apiClient.rekeyContainer.bind(
    context.common.apiClient,
  );
  context.common.apiClient.rekeyContainer = async (id, request) => {
    standaloneRepairs.push(id);
    const response = await rekey(id, request);
    if (input.loseFirstRepairResponse && !interrupted) {
      interrupted = true;
      throw lostResponse;
    }
    return response;
  };
  const submit = context.common.apiClient.syncDocument.bind(
    context.common.apiClient,
  );
  context.common.apiClient.syncDocument = (id, request) => {
    requests.push(request);
    return submit(id, request);
  };
  const syncInput = {
    ...context.common,
    documentId: input.documentId,
    isRemoteSyncBlocked: () => blocked,
    localVersionVector: null,
    resolveWriterPublicKey: async (reference: {
      writerSigningKeyFingerprint: string;
      writerUserId: string;
    }) =>
      (await writerResolver(input.owner)(reference)) ??
      writerResolver(input.writer)(reference),
    validateIncomingUpdates: (({ decryptedUpdates, response }) =>
      validateDocumentSyncUpdateImports({
        currentDocument: document,
        decryptedUpdates,
        responseUpdates: response.updates,
      })) satisfies Parameters<
      typeof syncRemoteDocument
    >[0]["validateIncomingUpdates"],
  };
  try {
    const read = await syncRemoteDocument(syncInput);
    if (!read) throw new Error("Expected cold ancestor recovery read");
    importUpdates(
      document,
      read.decryptedUpdates.map((update) => update.updateData),
    );
    const recoveredText = getTextValue(document);
    const before = encodeVersionVector(document);
    document.getText("text").update(`${recoveredText}; edited after rotation`);
    const updateData = exportUpdatesSince(document, before);
    const vectors = getUpdateVersionVectors(updateData);
    const updateId = crypto.randomUUID();
    const write = () =>
      syncRemoteDocument({
        ...syncInput,
        buildRotationSnapshot: async () => exportFullHistorySnapshot(document),
        pendingUpdates: [
          {
            id: updateId,
            partialEndVersionVector: vectors.partialEndVersionVector,
            partialStartVersionVector: vectors.partialStartVersionVector,
            updateData: bytesToBase64(updateData),
          },
        ],
      });
    if (input.blockBeforeRepair) {
      blocked = true;
      await write().then(
        () => {
          throw new Error("Expected a blocked repair failure");
        },
        (error: unknown) => {
          if (
            !(error instanceof Error) ||
            error.message !==
              "Document ancestor repair is blocked for this organization"
          )
            throw error;
        },
      );
      repairsWhileBlocked = standaloneRepairs.length;
      blocked = false;
    }
    const written = await write().catch((error: unknown) => {
      if (error !== lostResponse) throw error;
      return write();
    });
    if (!written) throw new Error("Expected automatic ancestor repair write");
    return {
      recoveredText,
      requests,
      standaloneRepairs,
      interrupted,
      repairsWhileBlocked,
      settledPendingUpdateIds: written.settledPendingUpdateIds,
      updateId,
    };
  } finally {
    context.close();
  }
}
