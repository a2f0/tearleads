import { expect, test } from "bun:test";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { createRuntimePrincipalPolicyWarmer } from "./runtimePolicyWarmer";

const REFERENCE: ReferencedPrincipalHead = {
  keyEpoch: 1,
  keyFingerprint: "group-key-fingerprint",
  principalId: "group-1",
  principalType: "group",
  stateHash: "group-state-hash",
  version: 1,
};

test("runtime policy warmer only uses the legacy adapter for the session organization", async () => {
  const cachedReferences: Array<readonly ReferencedPrincipalHead[]> = [];
  const warmer = createRuntimePrincipalPolicyWarmer({
    apiClient: {},
    auth: { organizationId: "home-organization" },
    infra: { execSql: (() => Promise.resolve([])) as ExecSql },
    resolveTrustedUserIdentity: async () => null,
    util: {
      cacheReferencedPrincipalPolicies: async (references) => {
        cachedReferences.push(references);
      },
      log: () => undefined,
    },
  });

  await warmer({
    organizationId: "home-organization",
    references: [REFERENCE],
  });
  await warmer({
    organizationId: "foreign-organization",
    references: [REFERENCE],
  });

  expect(cachedReferences).toEqual([[REFERENCE]]);
});
