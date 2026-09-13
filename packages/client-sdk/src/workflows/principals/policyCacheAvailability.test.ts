import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  cacheReferencedPolicies,
  createPrincipalPolicyBundle,
  referencedPrincipalStateFromBundle,
} from "../../../test/helpers/policyCacheFixtures";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";

test("an unreachable policy signer defers caching without an incident", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-signer-unavailable",
  );

  try {
    const { bundle } = await createPrincipalPolicyBundle();
    const incidents: unknown[] = [];
    const logs: string[] = [];

    await expect(
      cacheReferencedPolicies({
        execSql,
        organizationId: "org-1",
        getCurrentPrincipalPolicy: async () => bundle,
        getUserIdentity: async (userId) => {
          throw new ProjectionDependencyUnavailableError(
            `Remote user identity for ${userId} is unavailable: fetch failed`,
          );
        },
        log: (message) => logs.push(message),
        references: [referencedPrincipalStateFromBundle(bundle)],
        reportSecurityIncident: async (error) => {
          incidents.push(error);
        },
      }),
    ).resolves.toBeUndefined();
    expect(incidents).toEqual([]);
    expect(logs.some((entry) => entry.includes("fetch failed"))).toBe(true);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("a signer the server says does not exist is still integrity evidence", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-signer-unknown",
  );

  try {
    const { bundle } = await createPrincipalPolicyBundle();
    const incidents: unknown[] = [];

    await expect(
      cacheReferencedPolicies({
        execSql,
        organizationId: "org-1",
        getCurrentPrincipalPolicy: async () => bundle,
        getUserIdentity: async () => null,
        references: [referencedPrincipalStateFromBundle(bundle)],
        reportSecurityIncident: async (error) => {
          incidents.push(error);
        },
      }),
    ).rejects.toMatchObject({ code: "missing_dependency" });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ code: "missing_dependency" });
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
