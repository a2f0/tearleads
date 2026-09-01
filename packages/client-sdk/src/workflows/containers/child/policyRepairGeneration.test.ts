import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@symcrypt/crypto";
import { createMockApiClient, createTestExecSql } from "@symcrypt/test-utils";
import { createAuthor } from "../../../../test/helpers/containerFixtures";
import {
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { loadPrincipalPolicyBundleForReference } from "../../../data/persistence/principalPolicyReferencePersistence";
import { buildInitialGroupPolicyRequest } from "../../organizations/principalPolicy";
import { cacheRemoteContainerCreatePolicyRepair } from "./policyRepair";

test("stale-policy repair rolls back when its generation expires during verification", async () => {
  const database = await createTestExecSql(
    "container-create-policy-repair-generation",
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
  let reportedIncident = false;

  try {
    const repaired = await cacheRemoteContainerCreatePolicyRepair({
      apiClient: createMockApiClient(),
      execSql: database.execSql,
      failure: {
        message: "stale principal policy",
        ok: false,
        report: () => undefined,
        stalePrincipalPolicies: [bundle],
        status: 409,
      },
      organizationId: author.organizationId,
      reportSecurityIncident: async () => {
        reportedIncident = true;
      },
      resolveTrustedUserIdentity: async (userId) => {
        current = false;
        return userId === author.signerUserId
          ? createTestTrustedUserIdentity({
              encapsulationPublicKey: memberKem.publicKey,
              signingKeyFingerprint: author.signerKeyFingerprint,
              signingPublicKey,
              userId,
            })
          : null;
      },
      stillCurrent: () => current,
    });

    expect(repaired).toBe(false);
    expect(reportedIncident).toBe(false);
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
