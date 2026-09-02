import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { createAuthor } from "../../../test/helpers/containerFixtures";
import {
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { loadPrincipalPolicyBundleForReference } from "../../data/persistence/principalPolicyReferencePersistence";
import { cacheRemoteContainerPrincipalPolicies } from "../container-contents/remoteHydration/principalPolicyCache";
import { buildInitialGroupPolicyRequest } from "../organizations/principalPolicy";
import { createRuntimePrincipalPolicyWarmer } from "./runtimePolicyWarmer";

const REFERENCE: ReferencedPrincipalHead = {
  keyEpoch: 1,
  keyFingerprint: "group-key-fingerprint",
  principalId: "group-1",
  principalType: "group",
  stateHash: "group-state-hash",
  version: 1,
};

test("runtime policy warmer fetches policies for every requested organization", async () => {
  const { close, execSql } = await createTestExecSql(
    "runtime-principal-policy-warmer",
  );
  const requestedPolicies: string[] = [];
  const warmer = createRuntimePrincipalPolicyWarmer({
    apiClient: {
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        requestedPolicies.push(`${principalType}:${principalId}`);
        return null;
      },
    },
    infra: { execSql },
    resolveTrustedUserIdentity: async () => null,
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  });

  try {
    await warmer({
      organizationId: "home-organization",
      references: [REFERENCE],
    });
    await warmer({
      organizationId: "foreign-organization",
      references: [REFERENCE],
    });

    expect(requestedPolicies).toEqual(["group:group-1", "group:group-1"]);
  } finally {
    await close();
  }
});

test("remote policy warming rolls back a fetched policy after generation expiry", async () => {
  const database = await createTestExecSql(
    "runtime-principal-policy-warmer-generation",
  );
  const { author, signingPublicKey } = await createAuthor({
    organizationId: "organization-1",
    userId: "signer-user-1",
  });
  const memberKem = generateKemSeedAndKeyPair();
  const request = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: memberKem,
    groupId: "group-1",
    name: "Group 1",
    signerUserId: author.signerUserId,
    signingFingerprint: author.signerKeyFingerprint,
    signingKeyPair: {
      signingPrivateKey: author.signerPrivateKey,
      signingPublicKey,
    },
  });
  const bundle = await policyBundleFromInitialRequest(request);
  const reference = principalPolicyHead(bundle);
  let current = true;
  const warmer = createRuntimePrincipalPolicyWarmer({
    apiClient: {
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        expect([principalType, principalId]).toEqual(["group", "group-1"]);
        current = false;
        return bundle;
      },
    },
    infra: { execSql: database.execSql },
    resolveTrustedUserIdentity: async (userId) =>
      userId === author.signerUserId
        ? createTestTrustedUserIdentity({
            encapsulationPublicKey: memberKem.publicKey,
            signingKeyFingerprint: author.signerKeyFingerprint,
            signingPublicKey,
            userId,
          })
        : null,
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  });

  try {
    await cacheRemoteContainerPrincipalPolicies({
      cacheReferencedPrincipalPolicies: warmer,
      remoteContainers: [
        {
          metadataReferencedPrincipals: [reference],
          organizationId: author.organizationId,
        },
      ],
      stillCurrent: () => current,
    });

    expect(current).toBe(false);
    expect(
      await loadPrincipalPolicyCheckpoint(database.execSql, "group", "group-1"),
    ).toBeNull();
    expect(
      await loadPrincipalPolicyBundleForReference(
        database.execSql,
        reference,
        null,
      ),
    ).toBeNull();
  } finally {
    database.close();
  }
});
