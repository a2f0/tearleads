import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { createAuthor } from "../../../../test/helpers/containerFixtures";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { createInitializedContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { defaultContainerContentsPersistence } from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import { createContainerContentsWorkflowRuntime } from "../runtime";
import { shareContainerState } from "./share";

function withDirectUserGrant(input: {
  accessLevel: "read" | "write" | "admin";
  createdAt: string;
  projection: ContainerWriterProjectionResponse;
  referencedPrincipalHeads?: ReadonlyArray<Record<string, unknown>>;
  remoteAccessStateHash: string;
  remoteEpoch: number;
  updatedAt: string;
  userId: string;
}): ContainerWriterProjectionResponse {
  const target = input.projection.path.at(-1);
  const targetKek = input.projection.containerKeks.at(-1);
  if (!target || !targetKek) {
    throw new Error("Expected projection target.");
  }

  return {
    ...input.projection,
    createdAt: input.createdAt,
    containerKeks: [
      ...input.projection.containerKeks.slice(0, -1),
      {
        ...targetKek,
        accessManifestHash: input.remoteAccessStateHash,
      },
    ],
    path: [
      ...input.projection.path.slice(0, -1),
      {
        ...target,
        manifestHash: input.remoteAccessStateHash,
        state: {
          ...target.state,
          directGrants: [
            {
              accessLevel: input.accessLevel,
              subjectId: input.userId,
              subjectType: "user",
            },
          ],
          referencedPrincipalHeads: input.referencedPrincipalHeads ?? [],
          epoch: input.remoteEpoch,
        },
      },
    ],
    updatedAt: input.updatedAt,
  } as ContainerWriterProjectionResponse;
}

test("shareContainerState treats an existing matching user grant as an idempotent no-op", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-share-state-test",
  );

  try {
    const { author } = await createAuthor({
      organizationId: "organization-1",
      userId: "owner-user",
    });
    const keyPair = generateKemSeedAndKeyPair();
    const containerId = "containerContents-share-container";
    const recipientUserId = "recipient-user";
    const projection = await createContainerWriterProjectionFixture({
      containerId,
      encapsulationPublicKey: keyPair.publicKey,
      organizationId: author.organizationId,
      signerKeyFingerprint: author.signerKeyFingerprint,
      signerPrivateKey: author.signerPrivateKey,
      userId: author.signerUserId,
    });
    const remoteAccessStateHash = "remote-access-state-hash-2";
    const remoteCreatedAt = "2026-05-22T12:00:00.000Z";
    const remoteEpoch = 2;
    const remoteReferencedPrincipalHeads = [
      {
        keyEpoch: 1,
        keyFingerprint: "group-key-fingerprint",
        principalId: "group-1",
        principalType: "group",
        stateHash: "group-state-hash",
        version: 1,
      },
    ];
    const remoteUpdatedAt = "2026-05-22T12:30:00.000Z";
    const remoteProjection = withDirectUserGrant({
      accessLevel: "write",
      createdAt: remoteCreatedAt,
      projection,
      referencedPrincipalHeads: remoteReferencedPrincipalHeads,
      remoteAccessStateHash,
      remoteEpoch,
      updatedAt: remoteUpdatedAt,
      userId: recipientUserId,
    });
    let shareCallCount = 0;
    const cachedPrincipalReferences: unknown[][] = [];
    const logs: string[] = [];
    const runtime = createContainerContentsWorkflowRuntime({
      apiClient: createMockApiClient({
        getContainerWriterProjection: async () => remoteProjection,
        shareContainer: async () => {
          shareCallCount += 1;
          return null;
        },
      }),
      auth: {
        isAuthenticated: true,
        organizationId: author.organizationId,
        userId: author.signerUserId,
      },
      crypto: {
        encapsulationKeyPair: null,
        signingFingerprint: null,
        signingKeyPair: null,
      },
      infra: {
        blobStore: createMemoryBlobStore(),
        dbStatus: "ready",
        documentProjectors: defaultDocumentProjectorRegistry,
        execSql,
      },
      state: {
        containerId: null,
        domainScope: createDomainScope(),
        events: [],
        online: true,
      },
      util: {
        cacheReferencedPrincipalPolicies: async (references) => {
          cachedPrincipalReferences.push([...(references ?? [])]);
        },
        log: (message) => logs.push(message),
      },
    });
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const { doc, initialUpdate } =
      await createInitializedContainerMetadataDocument(containerId, {
        icon: null,
        name: "Docs",
      });
    const containerState: ContainerState = {
      container: {
        id: containerId,
        effectiveAccessLevel: "admin",
        organizationId: author.organizationId,
        parentId: null,
        metadataDocumentId: "stale-metadata-document",
        name: "Docs",
        icon: null,
      },
      doc,
      record: {
        accessEpoch: 1,
        accessStateHash: "stale-access-state-hash",
        contentKeyBundle: "stale-content-key-bundle",
        documentId: "stale-metadata-document",
        documentKekTargets: "stale-document-kek-targets",
        documentManifestBundle: "stale-document-manifest-bundle",
        id: containerId,
        lastCommitLsn: null,
        loroSnapshot: bytesToBase64(initialUpdate),
      },
    };

    const shared = await shareContainerState({
      accessLevel: "write",
      containerState,
      persistence: defaultContainerContentsPersistence,
      recipientUserId,
      resolveProjectionUserKey: async () => null,
      runtime,
    });

    expect(shareCallCount).toBe(0);
    expect(logs).toContain(
      `Container contents: skipped duplicate share for container ${containerId} with user ${recipientUserId}`,
    );
    expect(shared?.record).toEqual({
      accessEpoch: remoteEpoch,
      accessStateHash: remoteAccessStateHash,
      contentKeyBundle: null,
      documentId: `${containerId}-metadata-document`,
      documentKekTargets: null,
      documentManifestBundle: null,
      id: containerId,
      lastCommitLsn: null,
      loroSnapshot: expect.any(String),
    });
    expect(shared?.container.metadataDocumentId).toBe(
      `${containerId}-metadata-document`,
    );
    expect(shared?.container.createdAt).toBe(remoteCreatedAt);
    expect(shared?.container.serverCreatedAt).toBe(remoteCreatedAt);
    expect(shared?.container.serverUpdatedAt).toBe(remoteUpdatedAt);
    expect(shared?.container.updatedAt).toBe(remoteUpdatedAt);
    expect(cachedPrincipalReferences).toEqual([remoteReferencedPrincipalHeads]);
  } finally {
    close();
  }
});

test("shareContainerState reuses the idempotency projection for a new user share", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-share-state-new-share-test",
  );

  try {
    const { author } = await createAuthor({
      organizationId: "organization-1",
      userId: "owner-user",
    });
    const keyPair = generateKemSeedAndKeyPair();
    const containerId = "containerContents-new-share-container";
    const recipientUserId = "recipient-user";
    const projection = await createContainerWriterProjectionFixture({
      containerId,
      encapsulationPublicKey: keyPair.publicKey,
      organizationId: author.organizationId,
      signerKeyFingerprint: author.signerKeyFingerprint,
      signerPrivateKey: author.signerPrivateKey,
      userId: author.signerUserId,
    });
    let projectionCallCount = 0;
    const runtime = createContainerContentsWorkflowRuntime({
      apiClient: createMockApiClient({
        getContainerWriterProjection: async () => {
          projectionCallCount += 1;
          return projection;
        },
        getEncapsulationKey: async () => null,
      }),
      auth: {
        isAuthenticated: true,
        organizationId: author.organizationId,
        userId: author.signerUserId,
      },
      crypto: {
        encapsulationKeyPair: null,
        signingFingerprint: null,
        signingKeyPair: null,
      },
      infra: {
        blobStore: createMemoryBlobStore(),
        dbStatus: "ready",
        documentProjectors: defaultDocumentProjectorRegistry,
        execSql,
      },
      state: {
        containerId: null,
        domainScope: createDomainScope(),
        events: [],
        online: true,
      },
      util: {
        cacheReferencedPrincipalPolicies: async () => undefined,
        log: () => undefined,
      },
    });
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const { doc, initialUpdate } =
      await createInitializedContainerMetadataDocument(containerId, {
        icon: null,
        name: "Docs",
      });
    const containerState: ContainerState = {
      container: {
        id: containerId,
        effectiveAccessLevel: "admin",
        organizationId: author.organizationId,
        parentId: null,
        metadataDocumentId: `${containerId}-metadata-document`,
        name: "Docs",
        icon: null,
      },
      doc,
      record: {
        accessEpoch: 1,
        accessStateHash: projection.path.at(-1)?.manifestHash ?? null,
        contentKeyBundle: null,
        documentId: `${containerId}-metadata-document`,
        documentKekTargets: null,
        documentManifestBundle: null,
        id: containerId,
        lastCommitLsn: null,
        loroSnapshot: bytesToBase64(initialUpdate),
      },
    };

    const shared = await shareContainerState({
      accessLevel: "write",
      containerState,
      persistence: defaultContainerContentsPersistence,
      recipientUserId,
      resolveProjectionUserKey: async () => null,
      runtime,
    });

    expect(shared).toBeNull();
    expect(projectionCallCount).toBe(1);
  } finally {
    close();
  }
});
