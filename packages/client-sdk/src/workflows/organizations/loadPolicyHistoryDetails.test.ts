import { expect, mock, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { ORGANIZATION_PRESENTATION_ERROR_CODES } from "@tearleads/validators/response";
import { createOrganizationHistoryFixture } from "../../../test/helpers/organizationPolicyHistory";
import { organizationReadModelSnapshot } from "../../../test/helpers/organizationReadModelProjectionFixtures";
import { createDomainScope } from "../../data/domainScope";
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
import {
  captureOrganizationPresentationAccessAttempt,
  denyOrganizationPresentationAccess,
  restoreOrganizationPresentationAccess,
} from "./organizationPresentationAccessState";
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
    domainScope: createDomainScope(),
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

test("malformed evidence reports an incident and retains only verified entries", async () => {
  const { data, input, close } = await fixture();
  try {
    const evidence = data.evidence();
    evidence.organizationPayloads.pop();
    const reportSecurityIncident = mock(async () => {});
    const result = await loadPolicyHistoryDetails({
      ...input,
      reportSecurityIncident,
      apiClient: {
        getOrganizationPolicyHistoryResult: async () => ({
          ok: true,
          data: evidence,
        }),
      },
    });
    expect(result).toEqual(input.history);
    expect(reportSecurityIncident).toHaveBeenCalledTimes(1);
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

test("an unavailable signer preserves verified entries without a tampering incident", async () => {
  const { data, input, close } = await fixture();
  const reportSecurityIncident = mock(async () => {});
  try {
    const result = await loadPolicyHistoryDetails({
      ...input,
      resolveTrustedUserIdentity: async () => null,
      reportSecurityIncident,
      apiClient: {
        getOrganizationPolicyHistoryResult: async () => ({
          ok: true,
          data: data.evidence(),
        }),
      },
    });
    expect(result).toEqual(input.history);
    expect(reportSecurityIncident).not.toHaveBeenCalled();
  } finally {
    close();
  }
});

test("cached history is isolated from caller edits, identity scopes, and restored access", async () => {
  const { data, input, close } = await fixture();
  let requests = 0;
  const apiClient = {
    getOrganizationPolicyHistoryResult: async () => {
      requests += 1;
      return { ok: true as const, data: data.evidence() };
    },
  };
  try {
    const first = await loadPolicyHistoryDetails({ ...input, apiClient });
    const entry = first?.entries[0];
    if (!entry) throw new Error("Expected verified history");
    entry.groupChanges?.splice(0);
    const cached = await loadPolicyHistoryDetails({ ...input, apiClient });
    expect(cached?.entries[0]?.groupChanges).toHaveLength(1);
    expect(requests).toBe(1);
    const nextScope = { ...input, domainScope: createDomainScope() };
    await loadPolicyHistoryDetails({ ...nextScope, apiClient });
    expect(requests).toBe(2);
    const access = { ...input, requesterUserId: input.currentUserId };
    denyOrganizationPresentationAccess(access, ["readModel"]);
    expect(
      await loadPolicyHistoryDetails({ ...nextScope, apiClient }),
    ).toBeNull();
    expect(requests).toBe(2);
    expect(
      restoreOrganizationPresentationAccess(
        access,
        captureOrganizationPresentationAccessAttempt(access, "readModel"),
      ),
    ).toBe(true);
    await loadPolicyHistoryDetails({ ...nextScope, apiClient });
    expect(requests).toBe(3);
  } finally {
    close();
  }
});

test("a newer organization head fetches new evidence instead of reusing cached details", async () => {
  const { data, input, close } = await fixture();
  let requests = 0;
  const apiClient = {
    getOrganizationPolicyHistoryResult: async () => {
      requests += 1;
      return { ok: true as const, data: data.evidence(requests > 1) };
    },
  };
  try {
    await loadPolicyHistoryDetails({ ...input, apiClient });
    const response = organizationReadModelSnapshot({
      ...input,
      cursor: "cursor-2",
    });
    response.lanes.organizationPolicy.currentState =
      data.afterDeletion.currentState;
    await applyOrganizationReadModelResponse({
      ...input,
      requestedCursor: "cursor-1",
      response,
    });
    await savePrincipalPolicyBundle(
      input.execSql,
      data.afterDeletion,
      new Date().toISOString(),
      input.organizationId,
    );
    const next = await loadPolicyHistoryDetails({
      ...input,
      apiClient,
      history: buildOrganizationPolicyHistory(data.afterDeletion),
    });
    expect(requests).toBe(2);
    expect(next?.entries[0]?.groupChanges?.[0]?.changeType).toBe("deleted");
  } finally {
    close();
  }
});
