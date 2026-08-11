import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  KeyingVerificationError,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import type { TrustedUserIdentity } from "../../data/trustedUserIdentity";
import { buildInitialGroupPolicyRequest } from "../organizations/principalPolicy";
import { buildInitialOrganizationPolicyRequest } from "../registration/registerIdentity";
import { loadOrganizationExternalAdminPolicy } from "./externalAdminPolicy";

async function createExternalAdminFixture() {
  const organizationSignerKeys = generateSigningSeedAndKeyPair();
  const organizationSignerKem = generateKemSeedAndKeyPair();
  const organizationSignerUserId = crypto.randomUUID();
  const adminSignerKeys = generateSigningSeedAndKeyPair();
  const adminSignerKem = generateKemSeedAndKeyPair();
  const adminSignerUserId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const adminGroupId = crypto.randomUUID();
  const memberGroupId = crypto.randomUUID();
  const adminPolicy = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: adminSignerKem,
      groupId: adminGroupId,
      name: "Admins",
      signerUserId: adminSignerUserId,
      signingFingerprint: await toFingerprint(adminSignerKeys.signingPublicKey),
      signingKeyPair: adminSignerKeys,
    }),
  );
  const organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId,
      encapsulationPublicKey: organizationSignerKem.publicKey,
      groupHeads: [
        principalPolicyHead(adminPolicy),
        principalPolicyHead(adminPolicy, memberGroupId),
      ],
      memberGroupId,
      organizationId,
      signingKeyPair: organizationSignerKeys,
      userId: organizationSignerUserId,
    }),
  );
  const identities = new Map<string, TrustedUserIdentity>([
    [
      organizationSignerUserId,
      createTestTrustedUserIdentity({
        encapsulationKeyFingerprint: await toFingerprint(
          organizationSignerKem.publicKey,
        ),
        encapsulationPublicKey: organizationSignerKem.publicKey,
        signingKeyFingerprint: await toFingerprint(
          organizationSignerKeys.signingPublicKey,
        ),
        signingPublicKey: organizationSignerKeys.signingPublicKey,
        userId: organizationSignerUserId,
      }),
    ],
    [
      adminSignerUserId,
      createTestTrustedUserIdentity({
        encapsulationKeyFingerprint: await toFingerprint(
          adminSignerKem.publicKey,
        ),
        encapsulationPublicKey: adminSignerKem.publicKey,
        signingKeyFingerprint: await toFingerprint(
          adminSignerKeys.signingPublicKey,
        ),
        signingPublicKey: adminSignerKeys.signingPublicKey,
        userId: adminSignerUserId,
      }),
    ],
  ]);
  return {
    adminGroupId,
    adminPolicy,
    adminSignerUserId,
    identities,
    organizationId,
    organizationPolicy,
    organizationSignerUserId,
  };
}

test("an invalid organization policy cannot trigger Admins identity trust", async () => {
  const fixture = await createExternalAdminFixture();
  const resolvedUserIds: string[] = [];
  const tamperedOrganizationPolicy = {
    ...fixture.organizationPolicy,
    currentState: {
      ...fixture.organizationPolicy.currentState,
      signature: "tampered-signature",
    },
  };
  const { close, execSql } = await createTestExecSql(
    "external-admin-invalid-organization-first",
  );

  try {
    await expect(
      loadOrganizationExternalAdminPolicy({
        execSql,
        getCurrentPrincipalPolicy: async (principalType) =>
          principalType === "organization"
            ? tamperedOrganizationPolicy
            : fixture.adminPolicy,
        organizationId: fixture.organizationId,
        resolveTrustedUserIdentity: async (userId) => {
          resolvedUserIds.push(userId);
          return fixture.identities.get(userId) ?? null;
        },
      }),
    ).rejects.toBeInstanceOf(KeyingVerificationError);
  } finally {
    close();
  }

  expect(resolvedUserIds).toContain(fixture.organizationSignerUserId);
  expect(resolvedUserIds).not.toContain(fixture.adminSignerUserId);
});

test("a mismatched Admins head is rejected before signer identity trust", async () => {
  const fixture = await createExternalAdminFixture();
  const resolvedUserIds: string[] = [];
  const mismatchedAdminPolicy = {
    ...fixture.adminPolicy,
    currentState: {
      ...fixture.adminPolicy.currentState,
      stateHash: "mismatched-admin-state-hash",
    },
  };
  const { close, execSql } = await createTestExecSql(
    "external-admin-head-before-identity",
  );

  try {
    await expect(
      loadOrganizationExternalAdminPolicy({
        execSql,
        getCurrentPrincipalPolicy: async (principalType, principalId) => {
          if (principalType === "organization") {
            return fixture.organizationPolicy;
          }
          expect(principalId).toBe(fixture.adminGroupId);
          return mismatchedAdminPolicy;
        },
        organizationId: fixture.organizationId,
        resolveTrustedUserIdentity: async (userId) => {
          resolvedUserIds.push(userId);
          return fixture.identities.get(userId) ?? null;
        },
      }),
    ).rejects.toThrow(
      "reserved Admins policy does not match the signed organization directory",
    );
  } finally {
    close();
  }

  expect(resolvedUserIds).toContain(fixture.organizationSignerUserId);
  expect(resolvedUserIds).not.toContain(fixture.adminSignerUserId);
});
