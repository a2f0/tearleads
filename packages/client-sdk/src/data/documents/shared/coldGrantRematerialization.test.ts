import { expect, test } from "bun:test";
import {
  computeDocumentContentKeyTargetHash,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  encryptWithDek,
  generateKemSeedAndKeyPair,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getTextValue,
  getUpdateVersionVectors,
  importUpdates,
} from "@tearleads/loro";
import type {
  ContainerWriterProjectionResponse,
  DocumentContentKeyBundleResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { loadColdRecoveredDocumentInfo } from "../../../../test/helpers/coldDocumentInfo";
import {
  createManagedContainerWrap,
  createRotatedGroupPolicy,
} from "../../../../test/helpers/coldGrantPolicyFixtures";
import {
  createAuthor,
  createPendingUpdateRecord,
  fixtureHash,
} from "../../../../test/helpers/documentFixtures";
import { rotateRootKekKeyringFixture } from "../../../../test/helpers/keyringRotationFixtures";
import { principalPolicyHead } from "../../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import { withTestExecSql } from "../../../../test/helpers/withTestExecSql";
import {
  prepareDocumentOutgoingUpdates,
  unwrapDocumentSyncResponseContentKeys,
} from "../../../workflows/documents/syncContentKeys";
import { signDocumentOutgoingUpdate } from "../../../workflows/documents/syncPlanIdentity";
import { createRuntimePrincipalPolicyWarmer } from "../../../workflows/principals/runtimePolicyWarmer";
import { createProjectionCheckpointContext } from "../../keyingProjectionVerification/checkpointContext";
import { collectReferencedPrincipalPolicies } from "../../keyingProjectionVerification/principalPolicyVerification";
import {
  ensurePrincipalPolicyTables,
  savePrincipalPolicyBundle,
} from "../../persistence/principalPolicyPersistence";
import { decryptDocumentSyncUpdatesByEpoch } from "./crypto";

type ProjectionKek = ContainerWriterProjectionResponse["containerKeks"][number];

const DOCUMENT_ID = "550e8400-e29b-41d4-a716-446655440090";
const ORGANIZATION_ID = "organization-1";
const USER_ID = "user-1";

function rootOnlyProjection(
  rotated: Awaited<ReturnType<typeof rotateRootKekKeyringFixture>>,
  wraps: ProjectionKek["wraps"],
): ContainerWriterProjectionResponse {
  return {
    ...rotated.fixture.projection,
    containerId: rotated.successor.containerId,
    containerKeks: [{ ...rotated.successor, wraps }],
    path: [rotated.currentManifest],
  };
}

async function createContentKeyBundle(input: {
  containerId: string;
  containerKey: Uint8Array;
  containerKeyEpoch: number;
  containerKeyEpochId: string;
  containerManifestHash: string;
  contentKey: Uint8Array;
  contentKeyEpoch: number;
  linkSetManifestHash: string;
}): Promise<DocumentContentKeyBundleResponse> {
  const target = {
    containerId: input.containerId,
    containerKeyEpoch: input.containerKeyEpoch,
    containerKeyEpochId: input.containerKeyEpochId,
    containerManifestHash: input.containerManifestHash,
  };
  const wrapped = await encryptWithDek(input.contentKey, input.containerKey);

  return {
    contentKeyEpoch: input.contentKeyEpoch,
    documentId: DOCUMENT_ID,
    linkSetManifestHash: input.linkSetManifestHash,
    targetHash: await computeDocumentContentKeyTargetHash([target]),
    targets: [
      {
        ...target,
        wrappedKey: bytesToBase64(wrapped.ciphertext),
        wrappingMetadata: {
          suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
          iv: bytesToBase64(wrapped.iv),
        },
      },
    ],
  };
}

async function createDocumentEpochUpdate(input: {
  author: Awaited<ReturnType<typeof createAuthor>>["author"];
  bundle: DocumentContentKeyBundleResponse;
  contentKey: Uint8Array;
  id: string;
  updateData: Uint8Array;
}) {
  const vectors = getUpdateVersionVectors(input.updateData);
  const [prepared] = await prepareDocumentOutgoingUpdates({
    contentKey: input.contentKey,
    contentKeyEpoch: input.bundle.contentKeyEpoch,
    documentId: DOCUMENT_ID,
    organizationId: ORGANIZATION_ID,
    pendingUpdates: [
      createPendingUpdateRecord({
        id: input.id,
        partialEndVersionVector: vectors.partialEndVersionVector,
        partialStartVersionVector: vectors.partialStartVersionVector,
        updateData: bytesToBase64(input.updateData),
      }),
    ],
  });
  if (!prepared) {
    throw new Error("Expected prepared document update");
  }

  return signDocumentOutgoingUpdate({
    author: input.author,
    contentKeyEpoch: input.bundle.contentKeyEpoch,
    documentId: DOCUMENT_ID,
    expectedLinkSetManifestHash: input.bundle.linkSetManifestHash,
    expectedTargetHash: input.bundle.targetHash,
    organizationId: ORGANIZATION_ID,
    signedAt: "2026-08-12T12:00:00.000Z",
    update: prepared,
  });
}

function syncResponseUpdate(
  update: Awaited<ReturnType<typeof createDocumentEpochUpdate>>,
): DocumentSyncResponse["updates"][number] {
  return {
    accessEpoch: 1,
    authorFingerprint: String(
      Reflect.get(update.writeHeader, "writerKeyFingerprint"),
    ),
    createdAt: "2026-08-12T12:00:00.000Z",
    documentId: DOCUMENT_ID,
    encryptedData: update.encryptedData,
    id: update.id,
    partialEndVersionVector: update.partialEndVersionVector,
    partialStartVersionVector: update.partialStartVersionVector,
    plaintextHash: update.plaintextHash,
    writeHeader: update.writeHeader,
  };
}

async function createMultiEpochDocumentFixture(input: {
  author: Awaited<ReturnType<typeof createAuthor>>["author"];
  rotated: Awaited<ReturnType<typeof rotateRootKekKeyringFixture>>;
}) {
  const source = await createDocument("cold-grant-source");
  source.getText("text").update("before container rotation");
  source.commit();
  const historicalUpdate = exportUpdatesSince(source);
  const historicalFrontier = encodeVersionVector(source);
  source.getText("text").update("after container rotation");
  source.commit();
  const currentUpdate = exportUpdatesSince(source, historicalFrontier);
  const linkSetManifestHash = await fixtureHash("cold-grant-link-set");
  const historicalContentKey = crypto.getRandomValues(new Uint8Array(32));
  const currentContentKey = crypto.getRandomValues(new Uint8Array(32));
  const historicalBundle = await createContentKeyBundle({
    containerId: input.rotated.successor.containerId,
    containerKey: input.rotated.fixture.rootContainerKek,
    containerKeyEpoch: 1,
    containerKeyEpochId: input.rotated.predecessorEpochId,
    containerManifestHash: input.rotated.successor.accessManifestHash,
    contentKey: historicalContentKey,
    contentKeyEpoch: 1,
    linkSetManifestHash,
  });
  const currentBundle = await createContentKeyBundle({
    containerId: input.rotated.successor.containerId,
    containerKey: input.rotated.currentKey,
    containerKeyEpoch: input.rotated.successor.containerKeyEpoch,
    containerKeyEpochId: input.rotated.currentEpochId,
    containerManifestHash: input.rotated.successor.accessManifestHash,
    contentKey: currentContentKey,
    contentKeyEpoch: 2,
    linkSetManifestHash,
  });
  const updates = await Promise.all([
    createDocumentEpochUpdate({
      author: input.author,
      bundle: historicalBundle,
      contentKey: historicalContentKey,
      id: "550e8400-e29b-41d4-a716-446655440091",
      updateData: historicalUpdate,
    }),
    createDocumentEpochUpdate({
      author: input.author,
      bundle: currentBundle,
      contentKey: currentContentKey,
      id: "550e8400-e29b-41d4-a716-446655440092",
      updateData: currentUpdate,
    }),
  ]);
  const currentTarget = currentBundle.targets[0];
  if (!currentTarget) {
    throw new Error("Expected current document target");
  }

  return {
    response: {
      acceptedOutgoingUpdateIds: [],
      commitLsn: "0/16B6C50",
      contentKeyBundle: currentBundle,
      contentKeyBundles: [historicalBundle],
      documentId: DOCUMENT_ID,
      documentKekTargets: {
        documentId: DOCUMENT_ID,
        documentKeyTargetHash: currentBundle.targetHash,
        linkedContainerKeyEpochIds: [currentTarget.containerKeyEpochId],
        linkedContainerManifestHashes: [currentTarget.containerManifestHash],
        linkSetManifestHash,
        targets: [
          {
            containerId: currentTarget.containerId,
            containerKeyEpoch: currentTarget.containerKeyEpoch,
            containerKeyEpochId: currentTarget.containerKeyEpochId,
            containerManifestHash: currentTarget.containerManifestHash,
          },
        ],
      },
      pullPage: { hasMore: false, nextCursor: null },
      updates: updates.map(syncResponseUpdate),
    } satisfies DocumentSyncResponse,
  };
}

async function managedGrantFixture(input: {
  reader: Awaited<ReturnType<typeof createAuthor>>;
  rotated: Awaited<ReturnType<typeof rotateRootKekKeyringFixture>>;
}) {
  const previousMemberId = "previous-group-member";
  const previousMember = await createAuthor({
    organizationId: ORGANIZATION_ID,
    userId: previousMemberId,
  });
  const initialMemberKem = generateKemSeedAndKeyPair();
  const policies = await createRotatedGroupPolicy({
    author: previousMember.author,
    containerId: input.rotated.successor.containerId,
    initialMemberKem,
    initialUserId: previousMemberId,
    memberKem: {
      publicKey: input.rotated.fixture.publicKey,
      secretKey: input.rotated.fixture.secretKey,
    },
    signingPublicKey: previousMember.signingPublicKey,
    userId: USER_ID,
  });
  const wrap = await createManagedContainerWrap({
    bundle: policies.current,
    containerKey: input.rotated.currentKey,
    containerKeyEpochId: input.rotated.currentEpochId,
    wrapManifestHash: input.rotated.successor.accessManifestHash,
  });
  const resolvePreviousMember = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: initialMemberKem.publicKey,
    signingKeyFingerprint: previousMember.author.signerKeyFingerprint,
    signingPublicKey: previousMember.signingPublicKey,
    userId: previousMemberId,
  });
  const resolveReader = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: input.rotated.fixture.publicKey,
    signingKeyFingerprint: input.reader.author.signerKeyFingerprint,
    signingPublicKey: input.reader.signingPublicKey,
    userId: USER_ID,
  });

  return {
    policies,
    resolveTrustedUserIdentity: async (userId: string) =>
      (await resolvePreviousMember(userId)) ?? resolveReader(userId),
    wrap,
  };
}

for (const grantKind of ["user", "group"] as const) {
  test(`a fresh client rematerializes multi-epoch document state through a ${grantKind} grant`, async () => {
    const rotated = await rotateRootKekKeyringFixture();
    const reader = await createAuthor({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
    });
    const document = await createMultiEpochDocumentFixture({
      author: reader.author,
      rotated,
    });

    await withTestExecSql(`cold-${grantKind}-grant`, async (execSql) => {
      await ensurePrincipalPolicyTables(execSql);
      let wraps = rotated.successor.wraps;
      if (grantKind !== "user") {
        const managed = await managedGrantFixture({ reader, rotated });
        expect(managed.policies.current.currentState.keyEpoch).toBeGreaterThan(
          managed.policies.current.previousStates[0]?.state.keyEpoch ?? 0,
        );
        expect(managed.policies.current.currentProjection).toEqual([
          { role: "admin", userId: USER_ID },
        ]);
        let policyGetCount = 0;
        const warmReferencedPrincipalPolicies =
          createRuntimePrincipalPolicyWarmer({
            apiClient: {
              getCurrentPrincipalPolicy: async (principalType, principalId) => {
                policyGetCount += 1;
                expect({ principalId, principalType }).toEqual({
                  principalId:
                    managed.policies.current.currentState.principalId,
                  principalType: "group",
                });
                return managed.policies.current;
              },
            },
            infra: { execSql },
            resolveTrustedUserIdentity: managed.resolveTrustedUserIdentity,
            util: {
              log: () => undefined,
              reportSecurityIncident: async () => undefined,
            },
          });
        const [verifiedPolicy] = await collectReferencedPrincipalPolicies({
          checkpointContext: createProjectionCheckpointContext({ execSql }),
          organizationId: ORGANIZATION_ID,
          principalPolicyCache: new Map(),
          references: [principalPolicyHead(managed.policies.current)],
          resolveUserKey: managed.resolveTrustedUserIdentity,
          warmReferencedPrincipalPolicies,
        });

        expect(policyGetCount).toBe(1);
        expect(verifiedPolicy?.stateHash).toBe(
          managed.policies.current.currentState.stateHash,
        );
        wraps = [managed.wrap];
      }
      const projection = rootOnlyProjection(rotated, wraps);
      const contentKeysByEpoch = await unwrapDocumentSyncResponseContentKeys({
        currentContentKey: new Uint8Array(),
        currentContentKeyEpoch: 2,
        execSql,
        response: document.response,
        targetSecretKey: rotated.fixture.secretKey,
        trustedLocalProjection: true,
        writerProjection: {
          authorizingContainerPaths: [projection],
        } as unknown as DocumentWriterProjectionResponse,
      });

      expect([...contentKeysByEpoch.keys()].sort()).toEqual([1, 2]);
      const decrypted = await decryptDocumentSyncUpdatesByEpoch({
        contentKeysByEpoch,
        documentId: DOCUMENT_ID,
        organizationId: ORGANIZATION_ID,
        updates: document.response.updates,
      });
      const recovered = await createDocument(`cold-${grantKind}-reader`);
      importUpdates(
        recovered,
        decrypted.map((update) => update.updateData),
      );
      expect(getTextValue(recovered)).toBe("after container rotation");
      const { attributionGetCount, info } = await loadColdRecoveredDocumentInfo(
        {
          authorFingerprint: reader.author.signerKeyFingerprint,
          document: document.response,
          execSql,
          projection,
          recovered,
          userId: USER_ID,
        },
      );

      expect(attributionGetCount).toBe(1);
      expect(info.remoteInfo?.characterBlame?.unattributedCharacterCount).toBe(
        0,
      );
      expect(info.remoteInfo?.characterBlame?.writers).toEqual([
        expect.objectContaining({
          writerKeyFingerprint: reader.author.signerKeyFingerprint,
          writerUserId: USER_ID,
        }),
      ]);
    });
  });
}

test("an interrupted client warms a rotated-group policy and recovers in the same attempt", async () => {
  const rotated = await rotateRootKekKeyringFixture();
  const { author, signingPublicKey } = await createAuthor({
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
  });
  const policies = await createRotatedGroupPolicy({
    author,
    containerId: rotated.successor.containerId,
    memberKem: {
      publicKey: rotated.fixture.publicKey,
      secretKey: rotated.fixture.secretKey,
    },
    signingPublicKey,
    userId: USER_ID,
  });
  const currentWrap = await createManagedContainerWrap({
    bundle: policies.current,
    containerKey: rotated.currentKey,
    containerKeyEpochId: rotated.currentEpochId,
    wrapManifestHash: rotated.successor.accessManifestHash,
  });
  const document = await createMultiEpochDocumentFixture({ author, rotated });

  await withTestExecSql("cold-stale-group-grant", async (execSql) => {
    await ensurePrincipalPolicyTables(execSql);
    await savePrincipalPolicyBundle(
      execSql,
      policies.initial,
      "2026-08-12T12:01:00.000Z",
    );
    const resolveTrustedUserIdentity = createTestTrustedUserIdentityResolver({
      encapsulationPublicKey: rotated.fixture.publicKey,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey,
      userId: USER_ID,
    });
    let policyGetCount = 0;
    const warmReferencedPrincipalPolicies = createRuntimePrincipalPolicyWarmer({
      apiClient: {
        getCurrentPrincipalPolicy: async (principalType, principalId) => {
          policyGetCount += 1;
          expect({ principalId, principalType }).toEqual({
            principalId: policies.current.currentState.principalId,
            principalType: "group",
          });
          return policies.current;
        },
      },
      infra: { execSql },
      resolveTrustedUserIdentity,
      util: {
        log: () => undefined,
        reportSecurityIncident: async () => undefined,
      },
    });
    const [verifiedPolicy] = await collectReferencedPrincipalPolicies({
      checkpointContext: createProjectionCheckpointContext({ execSql }),
      organizationId: ORGANIZATION_ID,
      principalPolicyCache: new Map(),
      references: [principalPolicyHead(policies.current)],
      resolveUserKey: resolveTrustedUserIdentity,
      warmReferencedPrincipalPolicies,
    });

    expect(policyGetCount).toBe(1);
    expect(verifiedPolicy?.stateHash).toBe(
      policies.current.currentState.stateHash,
    );
    const contentKeysByEpoch = await unwrapDocumentSyncResponseContentKeys({
      currentContentKey: new Uint8Array(),
      currentContentKeyEpoch: 2,
      execSql,
      response: document.response,
      targetSecretKey: rotated.fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: {
        authorizingContainerPaths: [rootOnlyProjection(rotated, [currentWrap])],
      } as unknown as DocumentWriterProjectionResponse,
    });
    const decrypted = await decryptDocumentSyncUpdatesByEpoch({
      contentKeysByEpoch,
      documentId: DOCUMENT_ID,
      organizationId: ORGANIZATION_ID,
      updates: document.response.updates,
    });
    const recovered = await createDocument("interrupted-group-reader");
    importUpdates(
      recovered,
      decrypted.map((update) => update.updateData),
    );
    expect(getTextValue(recovered)).toBe("after container rotation");
  });
});
