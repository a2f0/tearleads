import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { createCurrentOrganizationRuntimeFixture } from "../../../test/helpers/currentOrganizationRuntime";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/internalRuntimeFixtures";
import { createOrganizationHistoryFixture } from "../../../test/helpers/organizationPolicyHistory";
import { organizationReadModelSnapshot } from "../../../test/helpers/organizationReadModelProjectionFixtures";
import { applyOrganizationReadModelResponse } from "../../data/persistence/organizations/organizationReadModelPersistence";
import { savePrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import { unavailableExecSql } from "../../data/sqlite/sqlSchema";
import { createOrganizationReadModelCoordinator } from "./organizationReadModels";

test("failed paged verification never falls back to an available full group history", async () => {
  const f = await createCurrentOrganizationRuntimeFixture({ aligned: true });
  try {
    const group = f.signed.members;
    const organizationId = f.signed.artifacts.organizationId;
    const response = organizationReadModelSnapshot({
      organizationId,
      currentUserId: "founder",
    });
    response.lanes.groups.groups = [
      {
        groupId: group.currentState.principalId,
        organizationId,
        createdAt: group.currentState.createdAt,
        isBuiltin: true,
        currentState: {
          ...group.currentState,
          memberCount: group.currentProjection.length,
        },
      },
    ];
    response.lanes.groups.memberGroupId = group.currentState.principalId;
    response.lanes.groupMemberships.groups =
      response.lanes.groupMemberships.groups.slice(-1).map((membership) => ({
        ...membership,
        groupId: group.currentState.principalId,
        stateHash: group.currentState.stateHash,
      }));
    response.lanes.grants.grants = [];
    await applyOrganizationReadModelResponse({
      currentUserId: "founder",
      execSql: f.options.execSql,
      requestedCursor: null,
      response,
    });
    await savePrincipalPolicyBundle(
      f.options.execSql,
      group,
      new Date().toISOString(),
      organizationId,
    );
    const failure = new KeyingVerificationError(
      "stale_predecessor",
      "Paged verification rejected a disconnected chain",
    );
    let attempts = 0;
    f.runtime.apiClient.getPrincipalPolicyPages = () => {
      attempts += 1;
      throw failure;
    };
    const coordinator = createOrganizationReadModelCoordinator(
      createInternalRuntimeFixture(() => f.runtime),
    );
    await expect(
      coordinator.loadGroupPolicyHistory(group.currentState.principalId),
    ).rejects.toBe(failure);
    expect(attempts).toBe(1);
    expect(f.fullReads()).toBe(0);
  } finally {
    f.close();
  }
});

test("a host without page custody refuses a cursor before reading local or remote history", async () => {
  const input = createWorkflowInputFixture({
    apiClient: createMockApiClient({}),
    auth: { organizationId: "org-a", userId: "user-a" },
    execSql: unavailableExecSql,
  });
  const coordinator = createOrganizationReadModelCoordinator(
    createInternalRuntimeFixture(() => input),
  );
  await expect(
    coordinator.loadGroupPolicyHistory("group-a", "org-a", 3),
  ).rejects.toMatchObject({ code: "invalid_shape" });
});

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
