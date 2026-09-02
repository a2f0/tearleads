import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  type ContainerWriterProjectionResponse,
  DOCUMENT_SYNC_ERROR_CODES,
} from "@tearleads/validators/response";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createResponseFromRequest } from "../../../../test/helpers/documentFixtures";
import { loadAccessManifestCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { CONTAINER_ALREADY_COMMITTED } from "./createWithMetadata";
import { createRemoteContainer } from "./remote";
import type { ContainerWorkflowRuntime } from "./types";

test("legacy container create finishes its remote metadata document without stale local settlement", async () => {
  const parent = await createParentProjection();
  const database = await createTestExecSql(
    "legacy-container-create-generation",
  );
  let childProjection: ContainerWriterProjectionResponse | null = null;
  let current = true;
  let documentCreateCount = 0;
  let projectionEvictionCount = 0;
  let projectionPrimed = false;

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
    createDocument: async () => null,
    createDocumentResult: async (
      request: Parameters<
        ContainerWorkflowRuntime["apiClient"]["createDocument"]
      >[0],
    ) => {
      documentCreateCount += 1;
      if (documentCreateCount === 1) {
        return {
          code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
          message:
            "POST /documents: 409 Conflict: targetContainerPathRefs[0] is stale",
          ok: false as const,
          report: () => undefined,
          status: 409,
        };
      }
      return {
        data: await createResponseFromRequest(request),
        ok: true as const,
      };
    },
    evictContainerWriterProjection: () => {
      projectionEvictionCount += 1;
    },
    getContainerWriterProjection: async (containerId: string) =>
      containerId === parent.projection.containerId
        ? parent.projection
        : childProjection,
    getCurrentPrincipalPolicy: async () => null,
    primeDocumentWriterProjection: () => {
      projectionPrimed = true;
    },
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
    expect(created).toBeNull();
    expect(documentCreateCount).toBe(2);
    expect(projectionEvictionCount).toBe(1);
    expect(projectionPrimed).toBe(false);
    await expect(
      loadAccessManifestCheckpoint(
        database.execSql,
        "container",
        parent.projection.organizationId,
        "legacy-child",
      ),
    ).resolves.toBeNull();
  } finally {
    database.close();
  }
});

test("legacy container create resumes metadata completion without deleting phase one", async () => {
  const parent = await createParentProjection();
  const database = await createTestExecSql("legacy-container-create-resume");
  let childProjection: ContainerWriterProjectionResponse | null = null;
  let containerCreateCount = 0;
  let documentCreateCount = 0;

  const apiClient = {
    createContainer: async (
      request: Parameters<
        ContainerWorkflowRuntime["apiClient"]["createContainer"]
      >[0],
    ) => {
      containerCreateCount += 1;
      if (containerCreateCount > 1) return null;
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
      return response;
    },
    createDocument: async (
      request: Parameters<
        ContainerWorkflowRuntime["apiClient"]["createDocument"]
      >[0],
    ) => {
      documentCreateCount += 1;
      return documentCreateCount === 1
        ? null
        : createResponseFromRequest(request);
    },
    deleteContainerResult: async () => {
      throw new Error("phase-one container must remain available for repair");
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
  const create = () =>
    createRemoteContainer({
      containerId: "legacy-repair-child",
      parentContainerId: parent.projection.containerId,
      parentProjection: parent.projection,
      resolveProjectionUserKey: resolveIdentity,
      runtime,
    });

  try {
    await expect(create()).resolves.toBeNull();
    await expect(create()).resolves.toBe(CONTAINER_ALREADY_COMMITTED);
    expect(containerCreateCount).toBe(2);
    expect(documentCreateCount).toBe(2);
  } finally {
    database.close();
  }
});
