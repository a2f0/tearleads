import { expect, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import { createWorkflowInputFixture } from "../../../test/helpers/internalRuntimeFixtures";
import { createDomainScope } from "../../data/domainScope";
import { createExecSql } from "../../data/sqlite/sqlSchema";
import { currentOrganizationMutation } from "./principalMutationScope";

test("organization mutations cannot outlive their session, identity, or database scope", () => {
  const original = createWorkflowInputFixture({
    apiClient: createMockApiClient(),
    auth: { organizationId: "org", userId: "owner" },
    execSql: createExecSql({ exec: async () => ({ rows: [] }) }),
  });
  let current = original;
  const captured = currentOrganizationMutation({
    workflowInput: () => current,
  });
  expect(captured.runtime).toBe(original);
  expect(captured.stillCurrent()).toBe(true);
  for (const replacement of [
    { ...original, auth: { ...original.auth, isAuthenticated: false } },
    { ...original, auth: { ...original.auth, userId: "other" } },
    { ...original, auth: { ...original.auth, organizationId: "other" } },
    {
      ...original,
      crypto: { ...original.crypto, signingFingerprint: "new-key" },
    },
    {
      ...original,
      state: { ...original.state, domainScope: createDomainScope() },
    },
    {
      ...original,
      infra: { ...original.infra, dbStatus: "terminated" as const },
    },
    {
      ...original,
      infra: {
        ...original.infra,
        execSql: createExecSql({ exec: async () => ({ rows: [] }) }),
      },
    },
  ]) {
    current = replacement;
    expect(captured.stillCurrent()).toBe(false);
  }
});
