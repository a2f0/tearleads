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
import {
  createMockRequestFailure,
  createTestExecSql,
} from "@tearleads/test-utils";
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
  // Status-bearing, as the real client is: a refusal naming the descendant
  // rekeys a rotation must carry is an answer, not an exception.
  const rotationResult =
    (operation: "move" | "rekey" | "revoke") =>
    async (id: string, request: ContainerMutationRequest) => {
      const path = `/containers/${id}/${operation}`;
      const response = await routeApp.request(path, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${actor.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });
      const value: unknown = await response.json();
      if (response.ok && isContainerMutationResponse(value)) {
        return { data: value, ok: true as const };
      }
      const code = Reflect.get(Object(value), "code");
      const requiredContainerIds = Reflect.get(
        Object(value),
        "requiredContainerIds",
      );
      return createMockRequestFailure({
        ...(typeof code === "string" ? { code } : {}),
        message: `Container ${operation} failed: ${JSON.stringify(value)}`,
        method: "POST",
        path,
        ...(Array.isArray(requiredContainerIds)
          ? { requiredContainerIds }
          : {}),
        status: response.status,
      });
    };
  apiClient.rekeyContainerResult = rotationResult("rekey");
  apiClient.revokeContainerResult = rotationResult("revoke");
  apiClient.moveContainerResult = rotationResult("move");
  apiClient.revokeContainer = (id, request) =>
    postMutation(`/containers/${id}/revoke`, request);
  apiClient.moveContainer = (id, request) =>
    postMutation(`/containers/${id}/move`, request);
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
  // The SDK prefers the status-bearing rekey, so that is the call to observe.
  const rekeyResult = context.common.apiClient.rekeyContainerResult?.bind(
    context.common.apiClient,
  );
  if (!rekeyResult) throw new Error("Expected a status-bearing rekey");
  context.common.apiClient.rekeyContainerResult = async (id, request) => {
    standaloneRepairs.push(id);
    const result = await rekeyResult(id, request);
    if (input.loseFirstRepairResponse && !interrupted) {
      interrupted = true;
      throw lostResponse;
    }
    return result;
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
      // A gated organization abandons the pass rather than failing it: the sync
      // lane records the reason and resolves null, matching every other blocked
      // write path. Nothing may be repaired remotely while blocked.
      const blockedAttempt = await write();
      if (blockedAttempt !== null) {
        throw new Error("Expected a blocked repair to abandon the pass");
      }
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
