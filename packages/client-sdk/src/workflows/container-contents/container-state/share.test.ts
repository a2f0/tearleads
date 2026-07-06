import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import type {
  ContainerWriterProjectionResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { createAuthor } from "../../../../test/helpers/containerFixtures";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { createInitializedContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { defaultContainerContentsPersistence } from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import { createContainerContentsWorkflowRuntime } from "../runtime";
import { shareContainerState, shareContainerStateWithGroup } from "./share";

function withDirectGrant(input: {
  accessLevel: "read" | "write" | "admin";
  createdAt: string;
  projection: ContainerWriterProjectionResponse;
  referencedPrincipalHeads: ReadonlyArray<Record<string, unknown>>;
  remoteAccessStateHash: string;
  remoteEpoch: number;
  subjectId: string;
  subjectType: "group" | "user";
  updatedAt: string;
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
              subjectId: input.subjectId,
              subjectType: input.subjectType,
            },
          ],
          referencedPrincipalHeads: input.referencedPrincipalHeads,
          epoch: input.remoteEpoch,
        },
      },
    ],
    updatedAt: input.updatedAt,
  } as ContainerWriterProjectionResponse;
}

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
  return withDirectGrant({
    accessLevel: input.accessLevel,
    createdAt: input.createdAt,
    projection: input.projection,
    referencedPrincipalHeads: input.referencedPrincipalHeads ?? [],
    remoteAccessStateHash: input.remoteAccessStateHash,
    remoteEpoch: input.remoteEpoch,
    subjectId: input.userId,
    subjectType: "user",
    updatedAt: input.updatedAt,
  });
}

function withDirectGroupGrant(input: {
  accessLevel: "read" | "write" | "admin";
  createdAt: string;
  groupId: string;
  pinnedKeyEpoch: number;
  projection: ContainerWriterProjectionResponse;
  remoteAccessStateHash: string;
  remoteEpoch: number;
  updatedAt: string;
}): ContainerWriterProjectionResponse {
  return withDirectGrant({
    accessLevel: input.accessLevel,
    createdAt: input.createdAt,
    projection: input.projection,
    referencedPrincipalHeads: [
      {
        keyEpoch: input.pinnedKeyEpoch,
        keyFingerprint: `group-key-fingerprint-${input.pinnedKeyEpoch}`,
        principalId: input.groupId,
        principalType: "group",
        stateHash: `group-state-hash-${input.pinnedKeyEpoch}`,
        version: input.pinnedKeyEpoch,
      },
    ],
    remoteAccessStateHash: input.remoteAccessStateHash,
    remoteEpoch: input.remoteEpoch,
    subjectId: input.groupId,
    subjectType: "group",
    updatedAt: input.updatedAt,
  });
}

// The dedup only reads bundle.currentState.keyEpoch; the rest of the bundle is
// irrelevant to the staleness decision, so this keeps the fixture minimal.
function groupPolicyBundleWithKeyEpoch(input: {
  groupId: string;
  keyEpoch: number;
}): PrincipalPolicyBundleResponse {
  return {
    currentState: {
      keyEpoch: input.keyEpoch,
      principalId: input.groupId,
      principalType: "group",
    },
  } as unknown as PrincipalPolicyBundleResponse;
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

function createShareTestRuntime(input: {
  apiClient: ReturnType<typeof createMockApiClient>;
  author: Awaited<ReturnType<typeof createAuthor>>["author"];
  execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"];
  logs: string[];
}): ReturnType<typeof createContainerContentsWorkflowRuntime> {
  return createContainerContentsWorkflowRuntime({
    apiClient: input.apiClient,
    auth: {
      isAuthenticated: true,
      organizationId: input.author.organizationId,
      userId: input.author.signerUserId,
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
      execSql: input.execSql,
    },
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      cacheReferencedPrincipalPolicies: async () => undefined,
      log: (message) => input.logs.push(message),
    },
  });
}

function createGroupShareContainerState(input: {
  containerId: string;
  doc: Awaited<
    ReturnType<typeof createInitializedContainerMetadataDocument>
  >["doc"];
  initialUpdate: Uint8Array;
  organizationId: string;
}): ContainerState {
  return {
    container: {
      id: input.containerId,
      effectiveAccessLevel: "admin",
      organizationId: input.organizationId,
      parentId: null,
      metadataDocumentId: `${input.containerId}-metadata-document`,
      name: "Docs",
      icon: null,
    },
    doc: input.doc,
    record: {
      accessEpoch: 1,
      accessStateHash: "stale-access-state-hash",
      contentKeyBundle: null,
      documentId: `${input.containerId}-metadata-document`,
      documentKekTargets: null,
      documentManifestBundle: null,
      id: input.containerId,
      lastCommitLsn: null,
      loroSnapshot: bytesToBase64(input.initialUpdate),
    },
  };
}

async function runGroupShareScenario(input: {
  currentGroupKeyEpoch: number;
  currentPolicyError?: boolean;
  grantedGroupId?: string;
  pinnedKeyEpoch: number;
  remoteAccessStateHash: string;
  requireExistingGrant?: boolean;
  testLabel: string;
}): Promise<{
  containerId: string;
  currentPolicyCalls: Array<{ principalId: string; principalType: string }>;
  groupId: string;
  logs: string[];
  shareCallCount: number;
  shared: Awaited<ReturnType<typeof shareContainerStateWithGroup>>;
}> {
  const { close, execSql } = await createTestExecSql(input.testLabel);

  try {
    const { author } = await createAuthor({
      organizationId: "organization-1",
      userId: "owner-user",
    });
    const keyPair = generateKemSeedAndKeyPair();
    const containerId = `${input.testLabel}-container`;
    const groupId = "members-group";
    const projection = await createContainerWriterProjectionFixture({
      containerId,
      encapsulationPublicKey: keyPair.publicKey,
      organizationId: author.organizationId,
      signerKeyFingerprint: author.signerKeyFingerprint,
      signerPrivateKey: author.signerPrivateKey,
      userId: author.signerUserId,
    });
    const remoteProjection = withDirectGroupGrant({
      accessLevel: "read",
      createdAt: "2026-05-22T12:00:00.000Z",
      groupId: input.grantedGroupId ?? groupId,
      pinnedKeyEpoch: input.pinnedKeyEpoch,
      projection,
      remoteAccessStateHash: input.remoteAccessStateHash,
      remoteEpoch: 2,
      updatedAt: "2026-05-22T12:30:00.000Z",
    });
    const currentPolicyCalls: Array<{
      principalId: string;
      principalType: string;
    }> = [];
    let shareCallCount = 0;
    const logs: string[] = [];
    const runtime = createShareTestRuntime({
      apiClient: createMockApiClient({
        getContainerWriterProjection: async () => remoteProjection,
        getCurrentPrincipalPolicy: async (principalType, principalId) => {
          currentPolicyCalls.push({ principalId, principalType });
          if (input.currentPolicyError) {
            throw new Error("current principal policy unavailable");
          }
          return groupPolicyBundleWithKeyEpoch({
            groupId,
            keyEpoch: input.currentGroupKeyEpoch,
          });
        },
        shareContainer: async () => {
          shareCallCount += 1;
          return null;
        },
      }),
      author,
      execSql,
      logs,
    });
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const { doc, initialUpdate } =
      await createInitializedContainerMetadataDocument(containerId, {
        icon: null,
        name: "Docs",
      });

    const shared = await shareContainerStateWithGroup({
      accessLevel: "read",
      containerState: createGroupShareContainerState({
        containerId,
        doc,
        initialUpdate,
        organizationId: author.organizationId,
      }),
      persistence: defaultContainerContentsPersistence,
      recipientGroupId: groupId,
      requireExistingGrant: input.requireExistingGrant,
      resolveProjectionUserKey: async () => null,
      runtime,
    });

    return {
      containerId,
      currentPolicyCalls,
      groupId,
      logs,
      shareCallCount,
      shared,
    };
  } finally {
    close();
  }
}

test("shareContainerStateWithGroup re-shares when the group key epoch advanced past the pinned grant", async () => {
  const {
    containerId,
    currentPolicyCalls,
    groupId,
    logs,
    shareCallCount,
    shared,
  } = await runGroupShareScenario({
    currentGroupKeyEpoch: 2,
    pinnedKeyEpoch: 1,
    remoteAccessStateHash: "remote-access-state-hash-stale",
    testLabel: "containerContents-share-group-stale",
  });

  expect(currentPolicyCalls).toEqual([
    { principalId: groupId, principalType: "group" },
  ]);
  expect(logs).toContain(
    `Container contents: re-sharing container ${containerId} with group ${groupId} because its key epoch advanced past the pinned grant`,
  );
  expect(logs).not.toContain(
    `Container contents: skipped duplicate share for container ${containerId} with group ${groupId}`,
  );
  // The dedup let the re-share through; it then no-ops in this harness because
  // the crypto writer context is unavailable, so the mutation is never sent.
  expect(logs).toContain(
    "Container contents: skipped container group share because the writer context is unavailable.",
  );
  expect(shared).toBeNull();
  expect(shareCallCount).toBe(0);
});

test("shareContainerStateWithGroup treats a current-epoch group grant as an idempotent no-op", async () => {
  const {
    containerId,
    currentPolicyCalls,
    groupId,
    logs,
    shareCallCount,
    shared,
  } = await runGroupShareScenario({
    currentGroupKeyEpoch: 2,
    pinnedKeyEpoch: 2,
    remoteAccessStateHash: "remote-access-state-hash-current",
    testLabel: "containerContents-share-group-current",
  });

  expect(currentPolicyCalls).toEqual([
    { principalId: groupId, principalType: "group" },
  ]);
  expect(logs).toContain(
    `Container contents: skipped duplicate share for container ${containerId} with group ${groupId}`,
  );
  expect(logs).not.toContain(
    `Container contents: re-sharing container ${containerId} with group ${groupId} because its key epoch advanced past the pinned grant`,
  );
  expect(shareCallCount).toBe(0);
  expect(shared?.record.accessEpoch).toBe(2);
  expect(shared?.record.accessStateHash).toBe(
    "remote-access-state-hash-current",
  );
});

test("shareContainerStateWithGroup falls back to an idempotent no-op when the current group head cannot be resolved", async () => {
  const { containerId, groupId, logs, shareCallCount, shared } =
    await runGroupShareScenario({
      currentGroupKeyEpoch: 2,
      currentPolicyError: true,
      pinnedKeyEpoch: 1,
      remoteAccessStateHash: "remote-access-state-hash-unresolved",
      testLabel: "containerContents-share-group-unresolved",
    });

  // The pinned epoch trails the (unseen) current head, but because the head
  // could not be resolved the share stays a best-effort no-op instead of
  // failing outright.
  expect(logs).toContain(
    `Container contents: could not resolve current key epoch for group ${groupId}: current principal policy unavailable`,
  );
  expect(logs).toContain(
    `Container contents: skipped duplicate share for container ${containerId} with group ${groupId}`,
  );
  expect(shareCallCount).toBe(0);
  expect(shared?.record.accessEpoch).toBe(2);
});

test("shareContainerStateWithGroup with requireExistingGrant refuses to mint a new grant", async () => {
  // The container grants a DIFFERENT group; the recipient members group has no
  // grant of its own. A server that redirected the re-share here (via a spoofed
  // system slot) must not be able to mint a fresh members grant.
  const {
    containerId,
    currentPolicyCalls,
    groupId,
    logs,
    shareCallCount,
    shared,
  } = await runGroupShareScenario({
    currentGroupKeyEpoch: 2,
    grantedGroupId: "unrelated-group",
    pinnedKeyEpoch: 2,
    remoteAccessStateHash: "remote-access-state-hash-no-grant",
    requireExistingGrant: true,
    testLabel: "containerContents-share-group-require-existing",
  });

  expect(logs).toContain(
    `Container contents: refused to create a new group grant for ${groupId} on container ${containerId} because the re-share requires an existing grant`,
  );
  expect(shareCallCount).toBe(0);
  expect(shared).toBeNull();
  // The grant check short-circuits before the current-head lookup.
  expect(currentPolicyCalls).toEqual([]);
});

test("shareContainerStateWithGroup with requireExistingGrant still re-wraps a stale existing grant", async () => {
  const { containerId, groupId, logs, shareCallCount } =
    await runGroupShareScenario({
      currentGroupKeyEpoch: 2,
      pinnedKeyEpoch: 1,
      remoteAccessStateHash: "remote-access-state-hash-stale-existing",
      requireExistingGrant: true,
      testLabel: "containerContents-share-group-require-existing-stale",
    });

  expect(logs).toContain(
    `Container contents: re-sharing container ${containerId} with group ${groupId} because its key epoch advanced past the pinned grant`,
  );
  expect(logs).not.toContain(
    `Container contents: refused to create a new group grant for ${groupId} on container ${containerId} because the re-share requires an existing grant`,
  );
  // Reached the group-share mutation (which no-ops in this harness because the
  // crypto writer context is unavailable), proving the re-wrap was not blocked.
  expect(logs).toContain(
    "Container contents: skipped container group share because the writer context is unavailable.",
  );
  expect(shareCallCount).toBe(0);
});
