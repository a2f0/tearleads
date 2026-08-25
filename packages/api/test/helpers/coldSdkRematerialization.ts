import type { TestUser } from "@symcrypt/bob-and-alice";
import {
  cacheReferencedPrincipalPolicies,
  createRemoteDocument,
  syncRemoteDocument,
  validateDocumentSyncUpdateImports,
} from "@symcrypt/client-sdk";
import { createTestTrustedUserIdentityResolver } from "@symcrypt/client-sdk/testing";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument as createLoroDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getTextValue,
  getUpdateVersionVectors,
  importUpdates,
} from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import type {
  DocumentCreateRequest,
  DocumentSyncRequest,
} from "@symcrypt/validators/request";
import {
  isContainerWriterProjectionResponse,
  isDocumentCreateResponse,
  isDocumentSyncResponse,
  isDocumentWriterProjectionResponse,
  isPrincipalPolicyBundleResponse,
} from "@symcrypt/validators/response";
import { routeApp } from "../../src/routeApp";

export const COLD_DOCUMENT_TEXT = "cold login decrypts rotated group data";

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function requireJson(
  response: Response,
  label: string,
): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${label} failed: ${await response.text()}`);
  }
  return response.json();
}

function createRouteSdkClient(token: string) {
  const primedDocumentProjections = new Map<string, unknown>();

  return {
    createDocument: async (request: DocumentCreateRequest) => {
      const value = await requireJson(
        await routeApp.request("/documents", {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify(request),
        }),
        "document create",
      );
      if (!isDocumentCreateResponse(value)) {
        throw new Error("document create returned an invalid response");
      }
      return value;
    },
    getContainerWriterProjection: async (containerId: string) => {
      const value = await requireJson(
        await routeApp.request(`/containers/${containerId}/writer-projection`, {
          headers: authHeaders(token),
        }),
        "container writer projection",
      );
      if (!isContainerWriterProjectionResponse(value)) {
        throw new Error("container writer projection is invalid");
      }
      return value;
    },
    getCurrentPrincipalPolicy: async (
      principalType: "group" | "organization",
      principalId: string,
    ) => {
      const value = await requireJson(
        await routeApp.request(
          `/principals/${principalType}/${principalId}/policy`,
          { headers: authHeaders(token) },
        ),
        "principal policy",
      );
      if (!isPrincipalPolicyBundleResponse(value)) {
        throw new Error("principal policy is invalid");
      }
      return value;
    },
    getDocumentWriterProjection: async (documentId: string) => {
      const primed = primedDocumentProjections.get(documentId);
      if (primed && isDocumentWriterProjectionResponse(primed)) {
        return primed;
      }
      const value = await requireJson(
        await routeApp.request(`/documents/${documentId}/writer-projection`, {
          headers: authHeaders(token),
        }),
        "document writer projection",
      );
      if (!isDocumentWriterProjectionResponse(value)) {
        throw new Error("document writer projection is invalid");
      }
      return value;
    },
    primeDocumentWriterProjection: (
      documentId: string,
      projection: unknown,
    ) => {
      primedDocumentProjections.set(documentId, projection);
    },
    syncDocument: async (documentId: string, request: DocumentSyncRequest) => {
      const value = await requireJson(
        await routeApp.request(`/documents/${documentId}/sync`, {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify(request),
        }),
        "document sync",
      );
      if (!isDocumentSyncResponse(value)) {
        throw new Error("document sync returned an invalid response");
      }
      return value;
    },
  };
}

function documentAuthor(user: TestUser, organizationId: string) {
  return {
    organizationId,
    signerDeviceId: `signing-key:${user.fingerprint}`,
    signerKeyFingerprint: user.fingerprint,
    signerPrivateKey: user.signing.signingPrivateKey,
    signerUserId: user.userId,
  };
}

function trustedResolver(...users: TestUser[]) {
  const resolvers = users.map((user) =>
    createTestTrustedUserIdentityResolver({
      encapsulationPublicKey: user.kem.publicKey,
      signingKeyFingerprint: user.fingerprint,
      signingPublicKey: user.signing.signingPublicKey,
      userId: user.userId,
    }),
  );
  return async (userId: string) => {
    for (const resolve of resolvers) {
      const identity = await resolve(userId);
      if (identity) {
        return identity;
      }
    }
    return null;
  };
}

function writerResolver(user: TestUser) {
  return async (input: {
    writerSigningKeyFingerprint: string;
    writerUserId: string;
  }) =>
    input.writerUserId === user.userId &&
    input.writerSigningKeyFingerprint === user.fingerprint
      ? user.signing.signingPublicKey
      : null;
}

export async function createEncryptedColdDocument(input: {
  containerId: string;
  organizationId: string;
  owner: TestUser;
}): Promise<{ documentId: string; updateId: string }> {
  const { close, execSql } = await createTestExecSql(
    `api-cold-owner-${crypto.randomUUID()}`,
  );
  const apiClient = createRouteSdkClient(input.owner.token);
  const resolveTrustedUserIdentity = trustedResolver(input.owner);
  const warmReferencedPrincipalPolicies = async (request: {
    organizationId: string;
    references: Parameters<
      typeof cacheReferencedPrincipalPolicies
    >[0]["references"];
  }) =>
    cacheReferencedPrincipalPolicies({
      execSql,
      getCurrentPrincipalPolicy: apiClient.getCurrentPrincipalPolicy,
      organizationId: request.organizationId,
      references: request.references,
      reportSecurityIncident: async () => undefined,
      resolveTrustedUserIdentity,
    });

  try {
    const created = await createRemoteDocument({
      apiClient,
      author: documentAuthor(input.owner, input.organizationId),
      containerId: input.containerId,
      execSql,
      resolveProjectionUserKey: resolveTrustedUserIdentity,
      targetSecretKey: input.owner.kem.secretKey,
      warmReferencedPrincipalPolicies,
    });
    if (!created) {
      throw new Error("expected the SDK to create the cold-login document");
    }

    const updateId = crypto.randomUUID();
    const document = await createLoroDocument(`cold-owner-${updateId}`);
    const partialStartVersionVector = encodeVersionVector(document);
    document.getText("text").update(COLD_DOCUMENT_TEXT);
    const updateData = exportUpdatesSince(document, partialStartVersionVector);
    const vectors = getUpdateVersionVectors(updateData);
    const synced = await syncRemoteDocument({
      apiClient,
      author: documentAuthor(input.owner, input.organizationId),
      documentId: created.documentId,
      execSql,
      localVersionVector: null,
      pendingUpdates: [
        {
          id: updateId,
          partialEndVersionVector: vectors.partialEndVersionVector,
          partialStartVersionVector: vectors.partialStartVersionVector,
          updateData: bytesToBase64(updateData),
        },
      ],
      resolveProjectionUserKey: resolveTrustedUserIdentity,
      resolveWriterPublicKey: writerResolver(input.owner),
      targetSecretKey: input.owner.kem.secretKey,
      validateIncomingUpdates: ({ decryptedUpdates, response }) =>
        validateDocumentSyncUpdateImports({
          currentDocument: document,
          decryptedUpdates,
          responseUpdates: response.updates,
        }),
      warmReferencedPrincipalPolicies,
      writerProjection: created.writerProjection,
    });
    if (!synced || !synced.settledPendingUpdateIds.includes(updateId)) {
      throw new Error("expected the SDK-authored update to reach the API");
    }

    return { documentId: created.documentId, updateId };
  } finally {
    close();
  }
}

export async function coldRematerializeEncryptedDocument(input: {
  documentId: string;
  organizationId: string;
  owner: TestUser;
  reader: TestUser;
}) {
  const { close, execSql } = await createTestExecSql(
    `api-cold-reader-${crypto.randomUUID()}`,
  );
  const apiClient = createRouteSdkClient(input.reader.token);
  const resolveTrustedUserIdentity = trustedResolver(input.owner, input.reader);
  let policyFetchCount = 0;
  const warmReferencedPrincipalPolicies = async (request: {
    organizationId: string;
    references: Parameters<
      typeof cacheReferencedPrincipalPolicies
    >[0]["references"];
  }) =>
    cacheReferencedPrincipalPolicies({
      execSql,
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        policyFetchCount += 1;
        return apiClient.getCurrentPrincipalPolicy(principalType, principalId);
      },
      organizationId: request.organizationId,
      references: request.references,
      reportSecurityIncident: async () => undefined,
      resolveTrustedUserIdentity,
    });

  try {
    const recovered = await createLoroDocument(
      `cold-reader-${crypto.randomUUID()}`,
    );
    const synced = await syncRemoteDocument({
      apiClient,
      author: documentAuthor(input.reader, input.organizationId),
      documentId: input.documentId,
      execSql,
      localVersionVector: null,
      resolveProjectionUserKey: resolveTrustedUserIdentity,
      resolveWriterPublicKey: writerResolver(input.owner),
      targetSecretKey: input.reader.kem.secretKey,
      validateIncomingUpdates: ({ decryptedUpdates, response }) =>
        validateDocumentSyncUpdateImports({
          currentDocument: recovered,
          decryptedUpdates,
          responseUpdates: response.updates,
        }),
      warmReferencedPrincipalPolicies,
    });
    if (!synced) {
      throw new Error("expected the cold SDK sync to succeed");
    }
    importUpdates(
      recovered,
      synced.decryptedUpdates.map((update) => update.updateData),
    );

    return {
      policyFetchCount,
      recoveredText: getTextValue(recovered),
      updateIds: synced.decryptedUpdates.map((update) => update.id),
    };
  } finally {
    close();
  }
}
