import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { createOrganizationHistoryFixture } from "../../../test/helpers/organizationPolicyHistory";
import { signedPrincipalPolicyBundle } from "../../../test/helpers/principalPolicyFixtures";
import { loadOrganizationExternalAdminPolicy } from "./externalAdminPolicy";

// The organization and its Admins group are two GETs. An honest Admins commit
// landing between them must read as a stale directory, never as tampering.

async function createAdminsRace() {
  const fixture = await createOrganizationHistoryFixture();
  const { admin } = fixture;
  // Same group key, so the current member envelopes still open for the admin.
  const advancedAdmin = await signedPrincipalPolicyBundle({
    memberEnvelopes: admin.currentMemberEnvelopes.envelopes,
    payloadCiphertext: admin.currentPayload.ciphertext,
    projection: admin.currentProjection,
    previousStates: [
      ...admin.previousStates,
      {
        state: admin.currentState,
        projection: admin.currentProjection,
        grants: admin.currentGrants,
      },
    ],
    signing: {
      ...admin.currentState,
      grants: admin.currentGrants,
      prevStateHash: admin.currentState.stateHash,
      signedAt: new Date().toISOString(),
      version: admin.currentState.version + 1,
    },
    signingPrivateKey: fixture.signingKeyPair.signingPrivateKey,
  });
  const advancedDirectory = await fixture.advanceDirectory(
    fixture.initial,
    advancedAdmin,
  );
  return { advancedAdmin, advancedDirectory, fixture };
}

async function loadWith(
  fixture: Awaited<ReturnType<typeof createOrganizationHistoryFixture>>,
  label: string,
  serve: {
    readonly admins: () => PrincipalPolicyBundleResponse;
    readonly organization: () => PrincipalPolicyBundleResponse;
  },
) {
  const { close, execSql } = await createTestExecSql(label);
  try {
    return await loadOrganizationExternalAdminPolicy({
      execSql,
      getCurrentPrincipalPolicy: async (principalType) =>
        principalType === "organization"
          ? serve.organization()
          : serve.admins(),
      organizationId: fixture.organizationId,
      resolveTrustedUserIdentity: fixture.resolveTrustedUserIdentity,
    });
  } finally {
    close();
  }
}

test("an Admins commit between the two reads is refetched, not an incident", async () => {
  const { advancedAdmin, advancedDirectory, fixture } =
    await createAdminsRace();
  const organizations = [fixture.initial, advancedDirectory];

  const loaded = await loadWith(fixture, "external-admin-race-refetch", {
    admins: () => advancedAdmin,
    organization: () => organizations.shift() ?? advancedDirectory,
  });

  expect(organizations).toEqual([]);
  expect(loaded?.adminBundle.currentState.stateHash).toBe(
    advancedAdmin.currentState.stateHash,
  );
});

test("a disagreement that survives the refetch is a cache miss", async () => {
  const { advancedAdmin, fixture } = await createAdminsRace();

  await expect(
    loadWith(fixture, "external-admin-race-miss", {
      admins: () => advancedAdmin,
      organization: () => fixture.initial,
    }),
  ).resolves.toBeNull();
});

test("an Admins head that does not extend the directory is still tampering", async () => {
  const { advancedDirectory, fixture } = await createAdminsRace();

  const rolledBack = loadWith(fixture, "external-admin-race-rollback", {
    admins: () => fixture.admin,
    organization: () => advancedDirectory,
  });

  await expect(rolledBack).rejects.toBeInstanceOf(KeyingVerificationError);
  await expect(rolledBack).rejects.toThrow(
    "reserved Admins policy does not match the signed organization directory",
  );
});
