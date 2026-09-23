import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type {
  ContainerWriterProjectionResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { createAuthor } from "../../../../test/helpers/containerFixtures";
import { buildInitialGroupPolicyRequest } from "../../../../test/helpers/groupMetadata";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { loadPrincipalPolicyBundleForReference } from "../../../data/persistence/principalPolicyReferencePersistence";
import { PrincipalPolicyRepairBudget } from "../../principals/policyRepairBudget";
import { buildInitialOrganizationPolicyRequest } from "../../registration/registerIdentity";
import { repairContainerCreateFailure } from "./createSubmission";
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

test("stale-policy repair preserves the API client receiver", async () => {
  const database = await createTestExecSql(
    "container-create-policy-repair-receiver",
  );
  const { author, signingPublicKey } = await createAuthor({
    organizationId: "organization-1",
    userId: "signer-user-1",
  });
  const memberKem = generateKemSeedAndKeyPair();
  const signingKeyPair = {
    signingPrivateKey: author.signerPrivateKey,
    signingPublicKey,
  };
  const adminBundle = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: memberKem,
      groupId: "admins-group-1",
      name: "Admins",
      signerUserId: author.signerUserId,
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair,
    }),
  );
  const adminHead = principalPolicyHead(adminBundle);
  if (adminHead.principalType !== "group") {
    throw new Error("Expected a group policy authority");
  }
  const staleBundle = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: memberKem,
      externalAuthority: { ...adminHead, principalType: "group" },
      groupId: "subject-group-1",
      includeSignerAsAdmin: false,
      name: "Subject",
      signerUserId: author.signerUserId,
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair,
    }),
  );
  const apiClient = createMockApiClient();
  let policyReceiver: unknown;
  apiClient.getCurrentPrincipalPolicy = async function () {
    policyReceiver = this;
    return null;
  };

  try {
    await expect(
      cacheRemoteContainerCreatePolicyRepair({
        apiClient,
        execSql: database.execSql,
        failure: {
          message: "stale principal policy",
          ok: false,
          report: () => undefined,
          stalePrincipalPolicies: [staleBundle],
          status: 409,
        },
        organizationId: author.organizationId,
        reportSecurityIncident: async () => undefined,
        resolveTrustedUserIdentity: async (userId) =>
          userId === author.signerUserId
            ? createTestTrustedUserIdentity({
                encapsulationPublicKey: memberKem.publicKey,
                signingKeyFingerprint: author.signerKeyFingerprint,
                signingPublicKey,
                userId,
              })
            : null,
      }),
    ).rejects.toMatchObject({ name: "KeyingVerificationError" });
    expect(policyReceiver).toBe(apiClient);
  } finally {
    database.close();
  }
});

test("container creation consumes a sixteen-bundle page and its remainder, then stops repeats", async () => {
  const database = await createTestExecSql("container-policy-repair-pages");
  try {
    const { author, signingPublicKey } = await createAuthor({
      organizationId: "organization-1",
      userId: "signer-user-1",
    });
    const memberKem = generateKemSeedAndKeyPair();
    const bundles: PrincipalPolicyBundleResponse[] = [];
    for (let index = 0; index < 17; index++) {
      bundles.push(
        await policyBundleFromInitialRequest(
          await buildInitialGroupPolicyRequest({
            creatorEncapsulationKeyPair: memberKem,
            groupId: `group-${index}`,
            name: `Group ${index}`,
            signerUserId: author.signerUserId,
            signingFingerprint: author.signerKeyFingerprint,
            signingKeyPair: {
              signingPrivateKey: author.signerPrivateKey,
              signingPublicKey,
            },
          }),
        ),
      );
    }
    const organizationBundle = await organizationPolicyBundleFromInitialRequest(
      author.organizationId,
      await buildInitialOrganizationPolicyRequest({
        adminGroupId: "group-0",
        memberGroupId: "group-1",
        organizationId: author.organizationId,
        encapsulationPublicKey: memberKem.publicKey,
        groupHeads: bundles.map((bundle) => principalPolicyHead(bundle)),
        signingKeyPair: {
          signingPrivateKey: author.signerPrivateKey,
          signingPublicKey,
        },
        userId: author.signerUserId,
      }),
    );
    const apiClient = createMockApiClient();
    apiClient.getCurrentPrincipalPolicy = async (type, id) =>
      type === "organization"
        ? organizationBundle
        : (bundles.find((bundle) => bundle.currentState.principalId === id) ??
          null);
    const state = {
      didRepairStaleParent: false,
      policyRepairs: new PrincipalPolicyRepairBudget(),
    };
    const results = [];
    for (const page of [
      bundles.slice(0, 16),
      bundles.slice(16),
      bundles.slice(16),
    ]) {
      results.push(
        await repairContainerCreateFailure({
          apiClient,
          execSql: database.execSql,
          failure: {
            ok: false,
            status: 409,
            message: "stale principal policy",
            report: () => {},
            stalePrincipalPolicies: page,
          },
          parentContainerId: "parent",
          parentProjection: {
            organizationId: author.organizationId,
          } as ContainerWriterProjectionResponse,
          reportSecurityIncident: async () => {},
          resolveTrustedUserIdentity: async (userId) =>
            userId === author.signerUserId
              ? createTestTrustedUserIdentity({
                  encapsulationPublicKey: memberKem.publicKey,
                  signingKeyFingerprint: author.signerKeyFingerprint,
                  signingPublicKey,
                  userId,
                })
              : null,
          state,
        }),
      );
    }
    expect(results.map((result) => result.kind)).toEqual([
      "retry",
      "retry",
      "none",
    ]);
    expect(
      await loadPrincipalPolicyCheckpoint(
        database.execSql,
        "group",
        "group-16",
      ),
    ).not.toBeNull();
  } finally {
    database.close();
  }
});
