import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import { createAuthor } from "../../../../test/helpers/containerFixtures";
import {
  createShareTestRuntime,
  runGroupShareScenario,
} from "../../../../test/helpers/groupShareScenario";
import { createInitializedContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import { defaultContainerContentsPersistence } from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import { shareContainerState } from "./share";
import { withDirectUserGrant } from "./share.testFixtures";

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
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      containerState.container,
      containerState.record,
    );
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
    if (shared?.status !== "persisted") throw new Error("Expected");
    expect(shared.record).toEqual({
      accessEpoch: remoteEpoch,
      accessStateHash: remoteAccessStateHash,
      contentKeyBundle: null,
      documentId: `${containerId}-metadata-document`,
      documentKekTargets: null,
      documentManifestBundle: null,
      id: containerId,
      lastCommitLsn: null,
      metadataUpdates: expect.any(String),
      pullContinuation: null,
      snapshotEndVersion: "",
    });
    expect(shared.container.metadataDocumentId).toBe(
      `${containerId}-metadata-document`,
    );
    expect(shared.container.createdAt).toBe(remoteCreatedAt);
    expect(shared.container.serverCreatedAt).toBe(remoteCreatedAt);
    expect(shared.container.serverUpdatedAt).toBe(remoteUpdatedAt);
    expect(shared.container.updatedAt).toBe(remoteUpdatedAt);
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
