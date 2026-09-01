import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createAuthor,
  SIGNED_AT,
} from "../../../test/helpers/containerFixtures";
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

test("stale required document create cannot warm a group policy", async () => {
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
  const root = await buildRootContainerCreatePlan({
    adminGroup,
    author,
    containerId,
    containerKey: crypto.getRandomValues(new Uint8Array(32)),
    metadataDocumentId: `${containerId}-metadata`,
    recipientEncapsulationPublicKey: memberKem.publicKey,
    signedAt: SIGNED_AT,
  });
  const projection = rootContainerWriterProjectionFromCreatePlan(root.plan);
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
  let submissions = 0;
  const warmReferencedPrincipalPolicies = createRuntimePrincipalPolicyWarmer({
    apiClient: {
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        policyGets += 1;
        expect({ principalId, principalType }).toEqual({
          principalId: groupId,
          principalType: "group",
        });
        return groupPolicy;
      },
    },
    infra: { execSql },
    resolveTrustedUserIdentity,
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  });

  try {
    const created = await createRemoteDocument({
      apiClient: {
        createDocument: async () => {
          submissions += 1;
          return null;
        },
        getContainerWriterProjection: async () => projection,
        primeDocumentWriterProjection: () => undefined,
      },
      author,
      containerId,
      containerProjection: projection,
      documentId: `${containerId}-metadata`,
      execSql,
      resolveProjectionUserKey: resolveTrustedUserIdentity,
      stillCurrent: () => false,
      submitWhenStale: true,
      targetSecretKey: memberKem.secretKey,
      warmReferencedPrincipalPolicies,
    });

    expect(created).toBeNull();
    expect(policyGets).toBe(0);
    expect(submissions).toBe(0);
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
