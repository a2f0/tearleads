import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createDocument, getTextValue, importUpdates } from "@tearleads/loro";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { loadColdRecoveredDocumentInfo } from "../../../../test/helpers/coldDocumentInfo";
import {
  createMultiEpochDocumentFixture,
  DOCUMENT_ID,
  ORGANIZATION_ID,
  rootOnlyProjection,
  USER_ID,
} from "../../../../test/helpers/coldGrantDocumentFixture";
import {
  createManagedContainerWrap,
  createRotatedGroupPolicy,
} from "../../../../test/helpers/coldGrantPolicyFixtures";
import { createAuthor } from "../../../../test/helpers/documentFixtures";
import { rotateRootKekKeyringFixture } from "../../../../test/helpers/keyringRotationFixtures";
import { principalPolicyHead } from "../../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import { withTestExecSql } from "../../../../test/helpers/withTestExecSql";
import { unwrapDocumentSyncResponseContentKeys } from "../../../workflows/documents/syncContentKeys";

import { createRuntimePrincipalPolicyWarmer } from "../../../workflows/principals/runtimePolicyWarmer";
import { createProjectionCheckpointContext } from "../../keyingProjectionVerification/checkpointContext";
import { collectReferencedPrincipalPolicies } from "../../keyingProjectionVerification/principalPolicyVerification";
import {
  ensurePrincipalPolicyTables,
  savePrincipalPolicyBundle,
} from "../../persistence/principalPolicyPersistence";
import { decryptDocumentSyncUpdatesByEpoch } from "./crypto";

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
      ORGANIZATION_ID,
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
