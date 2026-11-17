import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPolicyDirectoryFixture } from "../../../../test/helpers/data/policyDirectoryFixtures";
import {
  createPrincipalPolicyBundle,
  createSuccessorPrincipalPolicyBundle,
  referencedPrincipalStateFromBundle,
} from "../../../../test/helpers/data/principalPolicyBundles";
import { trustedUserIdentityFromResponse } from "../../../../test/helpers/data/trustedUserIdentity";
import { cacheReferencedPolicies } from "../../../../test/helpers/policyCacheFixtures";
import { KeyingCheckpointRepository } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointRepository";
import { PrincipalPolicyBundleRepository } from "../../../data/persistence/principalPolicy/principalPolicyBundleRepository";
import { cachePrincipalPolicyBundles } from "./index";

for (const scenario of [
  "missing-directory",
  "matching-directory",
  "foreign-organization",
] as const) {
  test(`API-supplied policy cache checks organization scope: ${scenario}`, async () => {
    const { close, execSql } = await createTestExecSql(
      `supplied-policy-${scenario}`,
    );
    try {
      const { bundle, getUserIdentity } = await createPrincipalPolicyBundle();
      const directory = await createPolicyDirectoryFixture({
        organizationId: "org-1",
        group: bundle,
      });
      const supplied =
        scenario === "foreign-organization" ? directory.bundle : bundle;
      await cachePrincipalPolicyBundles({
        bundles: [supplied],
        execSql,
        organizationId: scenario === "foreign-organization" ? "org-2" : "org-1",
        currentPolicyReader: {
          getCurrentPrincipalPolicy: async (kind, id) =>
            scenario === "matching-directory" &&
            kind === "organization" &&
            id === "org-1"
              ? directory.bundle
              : null,
        },
        reportSecurityIncident: async (error) => {
          throw error;
        },
        resolveTrustedUserIdentity: async (id) => {
          const response =
            id === directory.signer.userId
              ? directory.signer
              : await getUserIdentity(id);
          return response ? trustedUserIdentityFromResponse(response) : null;
        },
      });
      const stored = await new PrincipalPolicyBundleRepository(
        execSql,
      ).loadPrincipalPolicyBundle(
        supplied.currentState.principalType,
        supplied.currentState.principalId,
      );
      if (scenario === "matching-directory") {
        expect(stored?.currentState.stateHash).toBe(
          bundle.currentState.stateHash,
        );
        expect(
          (
            await new PrincipalPolicyBundleRepository(
              execSql,
            ).loadPrincipalPolicyBundle("organization", "org-1")
          )?.currentState.stateHash,
        ).toBe(directory.bundle.currentState.stateHash);
      } else {
        expect(stored).toBeNull();
        expect(
          await new KeyingCheckpointRepository(
            execSql,
          ).loadPrincipalPolicyCheckpoint(
            supplied.currentState.principalType,
            supplied.currentState.principalId,
          ),
        ).toBeNull();
      }
    } finally {
      close();
    }
  });
}

test("a standalone signed group cannot acquire an arbitrary organization through warming", async () => {
  const { close, execSql } = await createTestExecSql("policy-directory-scope");
  try {
    const { bundle, getUserIdentity } = await createPrincipalPolicyBundle();
    await cacheReferencedPolicies({
      execSql,
      organizationId: "foreign-organization",
      getCurrentPrincipalPolicy: async (kind) =>
        kind === "group" ? bundle : null,
      getUserIdentity,
      references: [referencedPrincipalStateFromBundle(bundle)],
    });
    expect(
      await new PrincipalPolicyBundleRepository(
        execSql,
      ).loadPrincipalPolicyBundle("group", "group-1"),
    ).toBeNull();
  } finally {
    close();
  }
});

for (const cached of [false, true]) {
  test(`a newer signed directory covers a historical group reference (cached=${cached})`, async () => {
    const { close, execSql } = await createTestExecSql(
      `policy-directory-history-${cached}`,
    );
    try {
      const { bundle, previousBundle, getUserIdentity } =
        await createSuccessorPrincipalPolicyBundle();
      const directory = await createPolicyDirectoryFixture({
        organizationId: "org-1",
        group: bundle,
      });
      if (cached)
        await new PrincipalPolicyBundleRepository(
          execSql,
        ).savePrincipalPolicyBundle(previousBundle, "org-1");
      let groupReads = 0;
      await cacheReferencedPolicies({
        directory,
        execSql,
        organizationId: "org-1",
        getCurrentPrincipalPolicy: async () => {
          groupReads += 1;
          return bundle;
        },
        getUserIdentity,
        references: [referencedPrincipalStateFromBundle(previousBundle)],
      });
      expect(groupReads).toBe(1);
      expect(
        (
          await new PrincipalPolicyBundleRepository(
            execSql,
          ).loadPrincipalPolicyBundle("group", "group-1")
        )?.currentState.stateHash,
      ).toBe(bundle.currentState.stateHash);
      expect(
        (
          await new KeyingCheckpointRepository(
            execSql,
          ).loadPrincipalPolicyCheckpoint("group", "group-1")
        )?.version,
      ).toBe(2);
    } finally {
      close();
    }
  });
}

test("a different same-version group chain is not authenticated by the directory", async () => {
  const { close, execSql } = await createTestExecSql("policy-directory-fork");
  try {
    const { bundle, getUserIdentity } = await createPrincipalPolicyBundle();
    const { bundle: other } = await createPrincipalPolicyBundle();
    const directory = await createPolicyDirectoryFixture({
      organizationId: "org-1",
      group: other,
    });
    const incidents: unknown[] = [];
    await cacheReferencedPolicies({
      directory,
      execSql,
      organizationId: "org-1",
      getCurrentPrincipalPolicy: async () => bundle,
      getUserIdentity,
      references: [referencedPrincipalStateFromBundle(bundle)],
      reportSecurityIncident: async (error) => {
        incidents.push(error);
      },
    });
    expect(
      (await new PrincipalPolicyBundleRepository(
        execSql,
      ).loadPrincipalPolicyBundle("group", "group-1")) === null,
    ).toBe(true);
    expect(
      await new KeyingCheckpointRepository(
        execSql,
      ).loadPrincipalPolicyCheckpoint("group", "group-1"),
    ).toBeNull();
    expect(incidents).toEqual([]);
  } finally {
    close();
  }
});

test("tampering with the signed organization directory aborts warming and reports evidence", async () => {
  const { close, execSql } = await createTestExecSql("policy-directory-tamper");
  try {
    const { bundle, getUserIdentity } = await createPrincipalPolicyBundle();
    const directory = await createPolicyDirectoryFixture({
      organizationId: "org-1",
      group: bundle,
    });
    const incidents: unknown[] = [];
    await expect(
      cacheReferencedPolicies({
        directory: {
          ...directory,
          bundle: {
            ...directory.bundle,
            currentPayload: {
              ...directory.bundle.currentPayload,
              ciphertext: "tampered",
            },
          },
        },
        execSql,
        organizationId: "org-1",
        getCurrentPrincipalPolicy: async () => bundle,
        getUserIdentity,
        references: [referencedPrincipalStateFromBundle(bundle)],
        reportSecurityIncident: async (error) => {
          incidents.push(error);
        },
      }),
    ).rejects.toMatchObject({ code: "hash_mismatch" });
    expect(
      (await new PrincipalPolicyBundleRepository(
        execSql,
      ).loadPrincipalPolicyBundle("group", "group-1")) === null,
    ).toBe(true);
    expect(
      await new KeyingCheckpointRepository(
        execSql,
      ).loadPrincipalPolicyCheckpoint("group", "group-1"),
    ).toBeNull();
    expect(incidents).toHaveLength(1);
  } finally {
    close();
  }
});
