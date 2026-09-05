import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import {
  createAuthor,
  SIGNED_AT,
} from "../../../test/helpers/containerFixtures";
import { createResponseFromRequest } from "../../../test/helpers/documentFixtures";
import { policyBundleFromInitialRequest } from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../test/helpers/trustedUserIdentity";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import {
  buildRootContainerCreatePlan,
  rootContainerWriterProjectionFromCreatePlan,
} from "../containers/root/create";
import { buildInitialGroupPolicyRequest } from "../organizations/principalPolicy";
import { createRuntimePrincipalPolicyWarmer } from "../principals/runtimePolicyWarmer";
import { createRemoteDocument } from "./create";

test("expired document create does not fetch or cache a refreshed group policy", async () => {
  const organizationId = "stale-document-create-organization";
  const userId = "stale-document-create-user";
  const groupId = "stale-document-create-admins";
  const containerId = "stale-document-create-root";
  const { author, signingPublicKey } = await createAuthor({
    organizationId,
    userId,
  });
  const memberKem = generateKemSeedAndKeyPair();
  const adminGroup = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: memberKem,
    grants: [{ accessLevel: "admin", containerId }],
    groupId,
    name: "Admins",
    signerUserId: userId,
    signingFingerprint: author.signerKeyFingerprint,
    signingKeyPair: {
      signingPrivateKey: author.signerPrivateKey,
      signingPublicKey,
    },
  });
  const groupPolicy = await policyBundleFromInitialRequest(adminGroup);
  const initialRoot = await buildRootContainerCreatePlan({
    author,
    containerId,
    containerKey: crypto.getRandomValues(new Uint8Array(32)),
    metadataDocumentId: `${containerId}-metadata`,
    recipientEncapsulationPublicKey: memberKem.publicKey,
    signedAt: SIGNED_AT,
  });
  const refreshedRoot = await buildRootContainerCreatePlan({
    adminGroup,
    author,
    containerId,
    containerKey: crypto.getRandomValues(new Uint8Array(32)),
    metadataDocumentId: `${containerId}-metadata`,
    recipientEncapsulationPublicKey: memberKem.publicKey,
    signedAt: SIGNED_AT,
  });
  const initialProjection = rootContainerWriterProjectionFromCreatePlan(
    initialRoot.plan,
  );
  const refreshedProjection = rootContainerWriterProjectionFromCreatePlan(
    refreshedRoot.plan,
  );
  const resolveTrustedUserIdentity = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: memberKem.publicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    signingPublicKey,
    userId,
  });
  const { close, execSql } = await createTestExecSql(
    "stale-document-create-policy-warm",
  );
  let policyGets = 0;
  let projectionEvictions = 0;
  let submissions = 0;
  let current = true;
  const warmReferencedPrincipalPolicies = createRuntimePrincipalPolicyWarmer({
    apiClient: createMockApiClient({
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        policyGets += 1;
        expect({ principalId, principalType }).toEqual({
          principalId: groupId,
          principalType: "group",
        });
        return groupPolicy;
      },
    }),
    infra: { execSql },
    resolveTrustedUserIdentity,
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  });

  try {
    const created = await createRemoteDocument({
      apiClient: createMockApiClient({
        createDocument: async () => {
          throw new Error("result-returning create should be used");
        },
        createDocumentResult: async (request) => {
          submissions += 1;
          if (submissions === 1) {
            current = false;
            return {
              kind: "http",
              method: "POST",
              path: "/documents",
              statusText: "Conflict",
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
          projectionEvictions += 1;
        },
        getContainerWriterProjection: async () => refreshedProjection,
        primeDocumentWriterProjection: () => undefined,
      }),
      author,
      containerId,
      containerProjection: initialProjection,
      documentId: `${containerId}-metadata`,
      execSql,
      knownContainerKeks: new Map([
        [initialRoot.plan.containerKeyEpochId, initialRoot.containerKey],
        [refreshedRoot.plan.containerKeyEpochId, refreshedRoot.containerKey],
      ]),
      resolveProjectionUserKey: resolveTrustedUserIdentity,
      stillCurrent: () => current,
      targetSecretKey: memberKem.secretKey,
      warmReferencedPrincipalPolicies,
    });

    expect(created).toBeNull();
    expect(current).toBe(false);
    expect(policyGets).toBe(0);
    expect(projectionEvictions).toBe(0);
    expect(submissions).toBe(1);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", groupId),
    ).resolves.toBeNull();
    await expect(
      loadPrincipalPolicyCheckpoint(execSql, "group", groupId),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
