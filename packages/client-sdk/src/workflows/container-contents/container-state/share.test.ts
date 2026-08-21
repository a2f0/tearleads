import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@symcrypt/test-utils";
import { createAuthor } from "../../../../test/helpers/containerFixtures";
import { createSuccessorGroupPolicyBundle } from "../../../../test/helpers/groupPolicyFixtures";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { createInitializedContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { buildInitialGroupPolicyRequest } from "../../organizations/principalPolicy";
import { buildInitialOrganizationPolicyRequest } from "../../registration/registerIdentity";
import { defaultContainerContentsPersistence } from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import { createContainerContentsWorkflowRuntime } from "../runtime";
import { shareContainerState, shareContainerStateWithGroup } from "./share";
import {
  withDirectGroupGrant,
  withDirectUserGrant,
} from "./share.testFixtures";

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
    const requestedPrincipalPolicies: string[] = [];
    const logs: string[] = [];
    const runtime = createShareTestRuntime({
      apiClient: createMockApiClient({
        getContainerWriterProjection: async () => remoteProjection,
        getCurrentPrincipalPolicy: async (principalType, principalId) => {
          requestedPrincipalPolicies.push(`${principalType}:${principalId}`);
          return null;
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
        metadataUpdates: bytesToBase64(initialUpdate),
        snapshotEndVersion: "",
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
      metadataUpdates: expect.any(String),
      snapshotEndVersion: "",
    });
    expect(shared?.container.metadataDocumentId).toBe(
      `${containerId}-metadata-document`,
    );
    expect(shared?.container.createdAt).toBe(remoteCreatedAt);
    expect(shared?.container.serverCreatedAt).toBe(remoteCreatedAt);
    expect(shared?.container.serverUpdatedAt).toBe(remoteUpdatedAt);
    expect(shared?.container.updatedAt).toBe(remoteUpdatedAt);
    expect(requestedPrincipalPolicies).toEqual(["group:group-1"]);
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
    const runtime = createShareTestRuntime({
      apiClient: createMockApiClient({
        getContainerWriterProjection: async () => {
          projectionCallCount += 1;
          return projection;
        },
        getUserIdentity: async () => null,
      }),
      author,
      execSql,
      logs: [],
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
        metadataUpdates: bytesToBase64(initialUpdate),
        snapshotEndVersion: "",
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
  resolveTrustedUserIdentity?:
    | ReturnType<
        typeof createContainerContentsWorkflowRuntime
      >["resolveTrustedUserIdentity"]
    | undefined;
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
    resolveTrustedUserIdentity:
      input.resolveTrustedUserIdentity ?? (async () => null),
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: (message) => input.logs.push(message),
      reportSecurityIncident: async () => undefined,
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
      metadataUpdates: bytesToBase64(input.initialUpdate),
      snapshotEndVersion: "",
    },
  };
}

async function runGroupShareScenario(input: {
  currentGroupKeyEpoch: number;
  currentPolicyError?: unknown;
  grantedGroupId?: string;
  onShareCall?: (() => void) | undefined;
  pinnedKeyEpoch: number;
  preparedRewrap?: boolean;
  remoteAccessStateHash: string;
  requireExistingGrant?: boolean;
  testLabel: string;
}): Promise<{
  containerId: string;
  currentGroupPolicyStateHash: string;
  currentPolicyCalls: Array<{ principalId: string; principalType: string }>;
  groupCheckpoint: Awaited<ReturnType<typeof loadPrincipalPolicyCheckpoint>>;
  groupId: string;
  logs: string[];
  shareCallCount: number;
  shared: Awaited<ReturnType<typeof shareContainerStateWithGroup>>;
}> {
  const { close, execSql } = await createTestExecSql(input.testLabel);

  try {
    const { author, signingPublicKey } = await createAuthor({
      organizationId: "organization-1",
      userId: "owner-user",
    });
    const keyPair = generateKemSeedAndKeyPair();
    const containerId = `${input.testLabel}-container`;
    const adminGroupId = "admins-group";
    const groupId = "members-group";
    const initialAdminPolicy = await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: keyPair,
      groupId: adminGroupId,
      name: "Admins",
      signerUserId: author.signerUserId,
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair: {
        signingPrivateKey: author.signerPrivateKey,
        signingPublicKey,
      },
    });
    const adminPolicy =
      await policyBundleFromInitialRequest(initialAdminPolicy);
    const initialGroupPolicy = await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: generateKemSeedAndKeyPair(),
      groupId,
      name: "Members",
      signerUserId: author.signerUserId,
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair: {
        signingPrivateKey: author.signerPrivateKey,
        signingPublicKey,
      },
    });
    const currentGroupPolicy = await createSuccessorGroupPolicyBundle({
      author,
      groupId,
      groupKem: generateKemSeedAndKeyPair(),
      keyEpoch: input.currentGroupKeyEpoch,
      memberPublicKey: keyPair.publicKey,
      previousBundle: await policyBundleFromInitialRequest(initialGroupPolicy),
      signedAt: "2026-05-22T12:15:00.000Z",
      userId: author.signerUserId,
    });
    const initialOrganizationPolicy =
      await buildInitialOrganizationPolicyRequest({
        adminGroupId,
        encapsulationPublicKey: keyPair.publicKey,
        groupHeads: [
          principalPolicyHead(adminPolicy),
          principalPolicyHead(currentGroupPolicy),
        ],
        memberGroupId: groupId,
        organizationId: author.organizationId,
        signingKeyPair: {
          signingPrivateKey: author.signerPrivateKey,
          signingPublicKey,
        },
        userId: author.signerUserId,
      });
    const organizationPolicy = await organizationPolicyBundleFromInitialRequest(
      author.organizationId,
      initialOrganizationPolicy,
    );
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
          if (principalType === "organization") {
            return organizationPolicy;
          }
          if (principalId === adminGroupId) {
            return adminPolicy;
          }
          currentPolicyCalls.push({ principalId, principalType });
          if (input.currentPolicyError) {
            if (input.currentPolicyError instanceof Error) {
              throw input.currentPolicyError;
            }
            throw new Error("current principal policy unavailable");
          }
          return currentGroupPolicy;
        },
        shareContainer: async () => {
          shareCallCount += 1;
          input.onShareCall?.();
          return null;
        },
      }),
      author,
      execSql,
      logs,
      resolveTrustedUserIdentity: async (userId) =>
        userId === author.signerUserId
          ? createTestTrustedUserIdentity({
              encapsulationPublicKey: keyPair.publicKey,
              signingKeyFingerprint: author.signerKeyFingerprint,
              signingPublicKey,
              userId,
            })
          : null,
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
      knownContainerKeks: input.preparedRewrap
        ? new Map([["captured-root-epoch", new Uint8Array(32)]])
        : undefined,
      persistence: defaultContainerContentsPersistence,
      recipientGroupId: groupId,
      requireExistingGrant: input.requireExistingGrant,
      resolveProjectionUserKey: async () => null,
      runtime,
    });

    return {
      containerId,
      currentGroupPolicyStateHash: currentGroupPolicy.currentState.stateHash,
      currentPolicyCalls,
      groupCheckpoint: await loadPrincipalPolicyCheckpoint(
        execSql,
        "group",
        groupId,
      ),
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
    currentGroupPolicyStateHash,
    currentPolicyCalls,
    groupCheckpoint,
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
  // The standalone key-epoch read has no enclosing mutation to advance its
  // verification, so it must commit the checkpoint itself — otherwise a newer
  // same-epoch policy could be rolled back on the next fetch.
  expect(groupCheckpoint).toMatchObject({
    stateHash: currentGroupPolicyStateHash,
  });
});

test("a prepared existing-grant re-wrap always attempts a real mutation", async () => {
  const {
    containerId,
    currentPolicyCalls,
    groupId,
    logs,
    shareCallCount,
    shared,
  } = await runGroupShareScenario({
    currentGroupKeyEpoch: 2,
    currentPolicyError: true,
    pinnedKeyEpoch: 2,
    preparedRewrap: true,
    remoteAccessStateHash: "remote-access-state-hash-current",
    requireExistingGrant: true,
    testLabel: "containerContents-share-group-current",
  });

  expect(currentPolicyCalls).toEqual([]);
  expect(logs).toContain(
    `Container contents: re-sharing container ${containerId} with group ${groupId} because an existing grant re-wrap is required`,
  );
  expect(logs).not.toContain(
    `Container contents: skipped duplicate share for container ${containerId} with group ${groupId}`,
  );
  expect(logs).toContain(
    "Container contents: skipped container group share because the writer context is unavailable.",
  );
  expect(shareCallCount).toBe(0);
  expect(shared).toBeNull();
});

test("a non-prepared existing-grant share fails closed when the current head cannot be resolved", async () => {
  let shareCalls = 0;

  await expect(
    runGroupShareScenario({
      currentGroupKeyEpoch: 2,
      currentPolicyError: true,
      onShareCall: () => {
        shareCalls += 1;
      },
      pinnedKeyEpoch: 1,
      remoteAccessStateHash: "remote-access-state-hash-unresolved",
      requireExistingGrant: true,
      testLabel: "containerContents-share-group-unresolved",
    }),
  ).rejects.toThrow("current principal policy unavailable");
  expect(shareCalls).toBe(0);
});

test("group share propagates identity failures without duplicate-share fallback", async () => {
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "trusted group identity changed",
  );
  let shareCalls = 0;

  await expect(
    runGroupShareScenario({
      currentGroupKeyEpoch: 2,
      currentPolicyError: integrityError,
      onShareCall: () => {
        shareCalls += 1;
      },
      pinnedKeyEpoch: 1,
      remoteAccessStateHash: "remote-access-state-hash-integrity-failure",
      requireExistingGrant: true,
      testLabel: "containerContents-share-group-integrity-failure",
    }),
  ).rejects.toBe(integrityError);
  expect(shareCalls).toBe(0);
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
  const { containerId, currentPolicyCalls, groupId, logs, shareCallCount } =
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
  expect(currentPolicyCalls).toEqual([
    { principalId: groupId, principalType: "group" },
  ]);
});
