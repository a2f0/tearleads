import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  cacheReferencedPolicies,
  createPrincipalPolicyBundle,
  createSuccessorPrincipalPolicyBundle,
  referencedPrincipalStateFromBundle,
} from "../../../test/helpers/policyCacheFixtures";
import { createPolicyDirectoryFixture } from "../../../test/helpers/policyDirectoryFixtures";
import { trustedUserIdentityFromResponse } from "../../../test/helpers/trustedUserIdentity";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import {
  loadPrincipalPolicyBundle,
  savePrincipalPolicyBundle,
} from "../../data/persistence/principalPolicyPersistence";
import { cachePrincipalPolicyBundles } from "./policyCache";

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
      const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
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
        getCurrentPrincipalPolicy: async (kind, id) =>
          scenario === "matching-directory" &&
          kind === "organization" &&
          id === "org-1"
            ? directory.bundle
            : null,
        reportSecurityIncident: async (error) => {
          throw error;
        },
        resolveTrustedUserIdentity: async (id) =>
          trustedUserIdentityFromResponse(
            id === directory.signer.userId
              ? directory.signer
              : signerKeyResponse,
          ),
      });
      const stored = await loadPrincipalPolicyBundle(
        execSql,
        supplied.currentState.principalType,
        supplied.currentState.principalId,
      );
      if (scenario === "matching-directory") {
        expect(stored?.currentState.stateHash).toBe(
          bundle.currentState.stateHash,
        );
        expect(
          (await loadPrincipalPolicyBundle(execSql, "organization", "org-1"))
            ?.currentState.stateHash,
        ).toBe(directory.bundle.currentState.stateHash);
      } else {
        expect(stored).toBeNull();
        expect(
          await loadPrincipalPolicyCheckpoint(
            execSql,
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
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
    await cacheReferencedPolicies({
      execSql,
      organizationId: "foreign-organization",
      getCurrentPrincipalPolicy: async (kind) =>
        kind === "group" ? bundle : null,
      getUserIdentity: async () => signerKeyResponse,
      references: [referencedPrincipalStateFromBundle(bundle)],
    });
    expect(
      await loadPrincipalPolicyBundle(execSql, "group", "group-1"),
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
      const { bundle, previousBundle, signerKeyResponse } =
        await createSuccessorPrincipalPolicyBundle();
      const directory = await createPolicyDirectoryFixture({
        organizationId: "org-1",
        group: bundle,
      });
      if (cached)
        await savePrincipalPolicyBundle(
          execSql,
          previousBundle,
          "2026-09-12T00:00:00.000Z",
          "org-1",
        );
      let groupReads = 0;
      await cacheReferencedPolicies({
        directory,
        execSql,
        organizationId: "org-1",
        getCurrentPrincipalPolicy: async () => {
          groupReads += 1;
          return bundle;
        },
        getUserIdentity: async () => signerKeyResponse,
        references: [referencedPrincipalStateFromBundle(previousBundle)],
      });
      expect(groupReads).toBe(1);
      expect(
        (await loadPrincipalPolicyBundle(execSql, "group", "group-1"))
          ?.currentState.stateHash,
      ).toBe(bundle.currentState.stateHash);
      expect(
        (await loadPrincipalPolicyCheckpoint(execSql, "group", "group-1"))
          ?.version,
      ).toBe(2);
    } finally {
      close();
    }
  });
}

test("a different same-version group chain is not authenticated by the directory", async () => {
  const { close, execSql } = await createTestExecSql("policy-directory-fork");
  try {
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
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
      getUserIdentity: async () => signerKeyResponse,
      references: [referencedPrincipalStateFromBundle(bundle)],
      reportSecurityIncident: async (error) => {
        incidents.push(error);
      },
    });
    expect(
      (await loadPrincipalPolicyBundle(execSql, "group", "group-1")) === null,
    ).toBe(true);
    expect(
      await loadPrincipalPolicyCheckpoint(execSql, "group", "group-1"),
    ).toBeNull();
    expect(incidents).toEqual([]);
  } finally {
    close();
  }
});

test("tampering with the signed organization directory aborts warming and reports evidence", async () => {
  const { close, execSql } = await createTestExecSql("policy-directory-tamper");
  try {
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
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
        getUserIdentity: async () => signerKeyResponse,
        references: [referencedPrincipalStateFromBundle(bundle)],
        reportSecurityIncident: async (error) => {
          incidents.push(error);
        },
      }),
    ).rejects.toMatchObject({ code: "hash_mismatch" });
    expect(
      (await loadPrincipalPolicyBundle(execSql, "group", "group-1")) === null,
    ).toBe(true);
    expect(
      await loadPrincipalPolicyCheckpoint(execSql, "group", "group-1"),
    ).toBeNull();
    expect(incidents).toHaveLength(1);
  } finally {
    close();
  }
});
