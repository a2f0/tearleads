import { expect, test } from "bun:test";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
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
