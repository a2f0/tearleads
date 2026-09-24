import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/internalRuntimeFixtures";
import { createOrganizationHistoryFixture } from "../../../test/helpers/organizationPolicyHistory";
import { organizationReadModelSnapshot } from "../../../test/helpers/organizationReadModelProjectionFixtures";
import { applyOrganizationReadModelResponse } from "../../data/persistence/organizations/organizationReadModelPersistence";
import { savePrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import { createOrganizationReadModelCoordinator } from "./organizationReadModels";

test("organization history enriches online and preserves verified local entries offline", async () => {
  const data = await createOrganizationHistoryFixture();
  const sql = await createTestExecSql("organization-coordinator-history");
  let requests = 0;
  const apiClient = createMockApiClient({
    async getOrganizationPolicyHistoryResult(organizationId, stateHash) {
      requests += 1;
      expect(organizationId).toBe(data.organizationId);
      expect(stateHash).toBe(data.afterAddition.currentState.stateHash);
      return { ok: true, data: data.evidence() };
    },
  });
  let input = createWorkflowInputFixture({
    apiClient,
    auth: { organizationId: data.organizationId, userId: data.signerUserId },
    execSql: sql.execSql,
    resolveTrustedUserIdentity: data.resolveTrustedUserIdentity,
  });
  const runtime = createInternalRuntimeFixture(() => input);
  const coordinator = createOrganizationReadModelCoordinator(runtime);
  try {
    const response = organizationReadModelSnapshot({
      organizationId: data.organizationId,
      currentUserId: data.signerUserId,
    });
    response.lanes.organizationPolicy.currentState =
      data.afterAddition.currentState;
    await applyOrganizationReadModelResponse({
      currentUserId: data.signerUserId,
      execSql: sql.execSql,
      requestedCursor: null,
      response,
    });
    await savePrincipalPolicyBundle(
      sql.execSql,
      data.afterAddition,
      new Date().toISOString(),
      data.organizationId,
    );
    const online = await coordinator.loadOrganizationPolicyHistory();
    expect(online?.entries[0]?.groupChanges?.[0]?.changes).toMatchObject([
      { userId: data.targetUserId, changeType: "added" },
    ]);
    expect(await coordinator.loadOrganizationPolicyHistory()).toEqual(online);
    expect(requests).toBe(1);
    input = { ...input, state: { ...input.state, online: false } };
    const offline = await coordinator.loadOrganizationPolicyHistory();
    expect(offline?.entries[0]?.stateHash).toBe(online?.entries[0]?.stateHash);
    expect(offline?.entries[0]?.groupChanges).toBeNull();
    expect(requests).toBe(1);
  } finally {
    sql.close();
  }
});
