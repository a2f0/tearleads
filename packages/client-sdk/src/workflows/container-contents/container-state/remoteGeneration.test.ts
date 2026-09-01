import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { ContainerWriterProjectionResponse } from "@symcrypt/validators/response";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createResponseFromRequest } from "../../../../test/helpers/documentFixtures";
import { createRemoteContainer } from "./remote";
import type { ContainerWorkflowRuntime } from "./types";

test("legacy container create finishes its metadata document after generation expiry", async () => {
  const parent = await createParentProjection();
  const database = await createTestExecSql(
    "legacy-container-create-generation",
  );
  let childProjection: ContainerWriterProjectionResponse | null = null;
  let current = true;
  let documentCreateCount = 0;

  const apiClient = {
    createContainer: async (
      request: Parameters<
        ContainerWorkflowRuntime["apiClient"]["createContainer"]
      >[0],
    ) => {
      const response = await createMutationResponseFromRequest(request);
      childProjection = {
        containerId: response.containerId,
        organizationId: response.organizationId,
        path: [...parent.projection.path, response.accessManifest],
        containerKeks: [
          ...parent.projection.containerKeks,
          response.containerKek,
        ],
      };
      current = false;
      return response;
    },
    createDocument: async (
      request: Parameters<
        ContainerWorkflowRuntime["apiClient"]["createDocument"]
      >[0],
    ) => {
      documentCreateCount += 1;
      return createResponseFromRequest(request);
    },
    getContainerWriterProjection: async (containerId: string) =>
      containerId === parent.projection.containerId
        ? parent.projection
        : childProjection,
    getCurrentPrincipalPolicy: async () => null,
    primeDocumentWriterProjection: () => undefined,
  } as unknown as ContainerWorkflowRuntime["apiClient"];
  const resolveIdentity = createParentProjectionUserKeyResolver(parent);
  const runtime = {
    apiClient,
    auth: {
      isAuthenticated: true,
      organizationId: parent.projection.organizationId,
      userId: parent.userId,
    },
    crypto: {
      encapsulationKeyPair: {
        publicKey: parent.encapsulationPublicKey,
        secretKey: parent.secretKey,
      },
      signingFingerprint: parent.author.signerKeyFingerprint,
      signingKeyPair: {
        signingPrivateKey: parent.author.signerPrivateKey,
        signingPublicKey: parent.signingPublicKey,
      },
    },
    infra: { execSql: database.execSql },
    resolveTrustedUserIdentity: resolveIdentity,
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  } as unknown as ContainerWorkflowRuntime;

  try {
    const created = await createRemoteContainer({
      containerId: "legacy-child",
      parentContainerId: parent.projection.containerId,
      parentProjection: parent.projection,
      resolveProjectionUserKey: resolveIdentity,
      runtime,
      stillCurrent: () => current,
    });

    expect(current).toBe(false);
    expect(created).not.toBeNull();
    expect(documentCreateCount).toBe(1);
  } finally {
    database.close();
  }
});
