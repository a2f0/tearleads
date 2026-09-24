import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { ORGANIZATION_PRESENTATION_ERROR_CODES } from "@tearleads/validators/response";
import { createOrganizationHistoryFixture } from "../../../test/helpers/organizationPolicyHistory";
import { organizationReadModelSnapshot } from "../../../test/helpers/organizationReadModelProjectionFixtures";
import {
  applyOrganizationReadModelResponse,
  loadOrganizationReadModelProjection,
} from "../../data/persistence/organizations/organizationReadModelPersistence";
import {
  loadPrincipalPolicyBundle,
  savePrincipalPolicyBundle,
} from "../../data/persistence/principalPolicyPersistence";
import { loadPolicyHistoryDetails } from "./loadPolicyHistoryDetails";
import { loadLocalOrganizationPolicyHistory } from "./localReadModelDetails";
import { buildOrganizationPolicyHistory } from "./policyHistoryReadModel";

async function fixture() {
  const data = await createOrganizationHistoryFixture();
  const sql = await createTestExecSql("organization-history-details");
  const common = {
    execSql: sql.execSql,
    organizationId: data.organizationId,
    currentUserId: data.signerUserId,
  };
  const snapshot = organizationReadModelSnapshot(common);
  snapshot.lanes.organizationPolicy.currentState =
    data.afterAddition.currentState;
  await applyOrganizationReadModelResponse({
    ...common,
    requestedCursor: null,
    response: snapshot,
  });
  await savePrincipalPolicyBundle(
    sql.execSql,
    data.afterAddition,
    new Date().toISOString(),
    data.organizationId,
  );
  const input = {
    ...common,
    history: buildOrganizationPolicyHistory(data.afterAddition),
    resolveTrustedUserIdentity: data.resolveTrustedUserIdentity,
    stillCurrent: () => true,
    logError: () => {},
  };
  return { data, close: sql.close, input };
}

test("history enrichment is memory-only and leaves persisted policy records unchanged", async () => {
  const { data, input, close } = await fixture();
  try {
    const before = await loadPrincipalPolicyBundle(
      input.execSql,
      "organization",
      input.organizationId,
    );
    const result = await loadPolicyHistoryDetails({
      ...input,
      apiClient: {
        getOrganizationPolicyHistoryResult: async () => ({
          ok: true,
          data: data.evidence(),
        }),
      },
    });
    expect(result?.entries[0]?.groupChanges?.[0]?.changes).toMatchObject([
      { userId: data.targetUserId, changeType: "added" },
    ]);
    expect(
      await loadPrincipalPolicyBundle(
        input.execSql,
        "organization",
        input.organizationId,
      ),
    ).toEqual(before);
    expect(
      (await loadLocalOrganizationPolicyHistory(input))?.entries[0]
        ?.groupChanges,
    ).toBeNull();
  } finally {
    close();
  }
});

test("history evidence cannot restore a presentation after its runtime changes", async () => {
  const { data, input, close } = await fixture();
  let current = true;
  try {
    expect(
      await loadPolicyHistoryDetails({
        ...input,
        stillCurrent: () => current,
        apiClient: {
          getOrganizationPolicyHistoryResult: async () => {
            current = false;
            return { ok: true, data: data.evidence() };
          },
        },
      }),
    ).toBeNull();
  } finally {
    close();
  }
});

test("malformed evidence retains only the selected verified entries without invented details", async () => {
  const { data, input, close } = await fixture();
  try {
    const evidence = data.evidence();
    evidence.organizationPayloads.pop();
    const result = await loadPolicyHistoryDetails({
      ...input,
      apiClient: {
        getOrganizationPolicyHistoryResult: async () => ({
          ok: true,
          data: evidence,
        }),
      },
    });
    expect(result).toEqual(input.history);
  } finally {
    close();
  }
});

test("history access denial durably purges the local presentation", async () => {
  const { input, close } = await fixture();
  try {
    expect(
      await loadPolicyHistoryDetails({
        ...input,
        apiClient: {
          getOrganizationPolicyHistoryResult: async () => ({
            ok: false,
            kind: "http",
            status: 403,
            code: ORGANIZATION_PRESENTATION_ERROR_CODES.accessDenied,
            message: "Organization access denied",
            method: "GET",
            path: "/policy-history",
            statusText: "Forbidden",
            report: () => {},
          }),
        },
      }),
    ).toBeNull();
    expect(await loadLocalOrganizationPolicyHistory(input)).toBeNull();
    expect(
      await loadOrganizationReadModelProjection(
        input.execSql,
        input.organizationId,
        input.currentUserId,
      ),
    ).toBeNull();
  } finally {
    close();
  }
});
