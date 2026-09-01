import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@symcrypt/test-utils";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { createContainerContentsWorkflowRuntime } from "../runtime";
import { createRemoteContainerWithMetadataDocument } from "./createWithMetadata";

test("container-with-metadata does not retry or report after stale-parent refresh expiry", async () => {
  const parent = await createParentProjection();
  const database = await createTestExecSql(
    "container-with-metadata-stale-parent-generation",
  );
  let current = true;
  let evictions = 0;
  let projectionReads = 0;
  let reported = false;
  let submissions = 0;
  const apiClient = createMockApiClient({
    createContainerWithMetadataDocumentResult: async () => {
      submissions += 1;
      return {
        kind: "http" as const,
        message:
          "POST /containers/with-metadata-document: 409 Conflict: parentContainerPath[0] manifest head is stale",
        method: "POST" as const,
        ok: false as const,
        path: "/containers/with-metadata-document",
        report: () => {
          reported = true;
        },
        status: 409,
        statusText: "Conflict",
      };
    },
    evictContainerWriterProjection: () => {
      evictions += 1;
    },
    getContainerWriterProjection: async () => {
      projectionReads += 1;
      current = false;
      return parent.projection;
    },
  });
  const runtime = createContainerContentsWorkflowRuntime({
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
    infra: {
      blobStore: createMemoryBlobStore(),
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: database.execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: parent.projection.containerId,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  });

  try {
    const result = await createRemoteContainerWithMetadataDocument({
      containerId: "expired-container",
      parentContainerId: parent.projection.containerId,
      parentProjection: parent.projection,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      runtime,
      stillCurrent: () => current,
    });

    expect(result).toBeNull();
    expect(submissions).toBe(1);
    expect(evictions).toBe(1);
    expect(projectionReads).toBe(1);
    expect(reported).toBe(false);
  } finally {
    database.close();
  }
});
