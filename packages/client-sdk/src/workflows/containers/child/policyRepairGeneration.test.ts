import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  ContainerWriterProjectionResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { createAuthor } from "../../../../test/helpers/containerFixtures";
import { buildInitialGroupPolicyRequest } from "../../../../test/helpers/groupMetadata";
import { createOrganizationHistoryFixture } from "../../../../test/helpers/organizationPolicyHistory";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../../test/helpers/principalPolicyFixtures";
import { createRepairWarmer } from "../../../../test/helpers/principalPolicyRepair";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { recoverPrincipalPolicyRepair } from "../../principals/policyRepair";
import { PrincipalPolicyRepairBudget } from "../../principals/policyRepairBudget";
import { buildInitialOrganizationPolicyRequest } from "../../registration/registerIdentity";
import { repairContainerCreateFailure } from "./createSubmission";

test("stale-policy repair refuses expired verification without admitting a pin", async () => {
  const history = await createOrganizationHistoryFixture();
  const database = await createTestExecSql("repair-generation");
  let current = true;
  const { warmer } = createRepairWarmer({
    execSql: database.execSql,
    bundles: [history.afterCreation, history.admin, history.created],
    stillCurrent: () => current,
    resolveTrustedUserIdentity: async (userId) => {
      current = false;
      return history.resolveTrustedUserIdentity(userId);
    },
  });
  try {
    await expect(
      recoverPrincipalPolicyRepair({
        heads: [principalPolicyHead(history.created)],
        organizationId: history.organizationId,
        warmReferencedPrincipalPolicies: warmer,
        stillCurrent: () => current,
      }),
    ).rejects.toThrow("generation expired");
    expect(
      await loadPrincipalPolicyCheckpoint(
        database.execSql,
        "group",
        history.created.currentState.principalId,
      ),
    ).toBeNull();
  } finally {
    database.close();
  }
});

test("stale-policy recovery preserves the paged API receiver and admits no hint checkpoint", async () => {
  const history = await createOrganizationHistoryFixture();
  const database = await createTestExecSql("repair-receiver");
  const { warmer, requests } = createRepairWarmer({
    execSql: database.execSql,
    bundles: [history.afterCreation, history.admin, history.created],
    resolveTrustedUserIdentity: history.resolveTrustedUserIdentity,
  });
  try {
    expect(
      await recoverPrincipalPolicyRepair({
        heads: [principalPolicyHead(history.created)],
        organizationId: history.organizationId,
        warmReferencedPrincipalPolicies: warmer,
      }),
    ).toBe(true);
    expect(
      requests.some(
        (request) =>
          request.principalId === history.created.currentState.principalId,
      ),
    ).toBe(true);
    expect(
      await loadPrincipalPolicyCheckpoint(
        database.execSql,
        "group",
        history.created.currentState.principalId,
      ),
    ).toBeNull();
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
    const { apiClient, warmer, requests } = createRepairWarmer({
      execSql: database.execSql,
      bundles: [organizationBundle, ...bundles],
      resolveTrustedUserIdentity: async (userId) =>
        userId === author.signerUserId
          ? createTestTrustedUserIdentity({
              encapsulationPublicKey: memberKem.publicKey,
              signingKeyFingerprint: author.signerKeyFingerprint,
              signingPublicKey,
              userId,
            })
          : null,
    });
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
          failure: {
            ok: false,
            status: 409,
            message: "stale principal policy",
            report: () => {},
            stalePrincipalHeads: page.map((bundle) =>
              principalPolicyHead(bundle),
            ),
          },
          parentContainerId: "parent",
          parentProjection: {
            organizationId: author.organizationId,
          } as ContainerWriterProjectionResponse,
          warmReferencedPrincipalPolicies: warmer,
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
    ).toBeNull();
    expect(requests.some((request) => request.principalId === "group-16")).toBe(
      true,
    );
  } finally {
    database.close();
  }
});
