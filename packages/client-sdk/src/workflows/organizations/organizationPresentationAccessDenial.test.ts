import { expect, test } from "bun:test";
import type { RequestResult } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  ORGANIZATION_PRESENTATION_ERROR_CODES,
  type OrganizationReadModelResponse,
  type OrganizationReadModelSnapshotResponse,
  type PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import {
  dataUsage,
  organizationPrincipalPolicy,
  principalPolicy,
} from "../../../test/helpers/organizationReadModelFixtures";
import {
  organizationReadModelFailure,
  organizationReadModelGroupsDelta,
  organizationReadModelOrganizationId,
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../../test/helpers/organizationReadModelProjectionFixtures";
import { createRejectingExecSql } from "../../../test/helpers/rejectingExecSql";
import { ensureContainerTables } from "../../data/persistence/containers/containerPersistence";
import { loadOrganizationDataUsageProjection } from "../../data/persistence/organizations/organizationDataUsagePersistence";
import {
  applyOrganizationReadModelResponse,
  loadOrganizationReadModelProjection,
} from "../../data/persistence/organizations/organizationReadModelPersistence";
import { savePrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  loadLocalOrganizationDataUsage,
  reconcileOrganizationDataUsage,
} from "./dataUsageReadModel";
import {
  loadLocalOrganizationContainerGrants,
  loadLocalOrganizationGroupContainers,
  loadLocalOrganizationGroupPolicyHistory,
  loadLocalOrganizationPolicyHistory,
  loadLocalOrganizationPolicyReference,
  loadLocalOrganizationUserDetail,
} from "./localReadModelDetails";
import {
  denyOrganizationPresentationAccess,
  runOrganizationPresentationRead,
} from "./organizationPresentationAccessState";
import {
  loadLocalOrganizationDirectoryAndGroups,
  loadLocalOrganizationGroupMembers,
  reconcileOrganizationDirectoryAndGroups,
} from "./readModelProjection";

const organizationId = organizationReadModelOrganizationId;
const requesterUserId = organizationReadModelUserId;
const groupId = `group-${organizationId}`;
const targetUserId = "user-2";
const persistedAt = "2026-07-18T12:00:00.000Z";

function groupPolicyBundle(): PrincipalPolicyBundleResponse {
  return {
    ...principalPolicy,
    currentState: { ...principalPolicy.currentState, principalId: groupId },
    currentPayload: { ...principalPolicy.currentPayload, principalId: groupId },
    currentMemberEnvelopes: {
      ...principalPolicy.currentMemberEnvelopes,
      principalId: groupId,
    },
    previousStates: principalPolicy.previousStates.map((entry) => ({
      ...entry,
      state: { ...entry.state, principalId: groupId },
    })),
  };
}

function presentationSnapshot(
  cursor = "cursor-presentation",
): OrganizationReadModelSnapshotResponse {
  const base = organizationReadModelSnapshot({ cursor });
  const groupHead = groupPolicyBundle().currentState;
  const organizationHead = organizationPrincipalPolicy.currentState;
  return {
    ...base,
    lanes: {
      ...base.lanes,
      groups: {
        ...base.lanes.groups,
        groups: base.lanes.groups.groups.map((group) =>
          group.groupId === groupId
            ? {
                ...group,
                currentState: {
                  stateHash: groupHead.stateHash,
                  version: groupHead.version,
                  keyEpoch: groupHead.keyEpoch,
                  keyFingerprint: groupHead.keyFingerprint,
                  memberCount: groupHead.memberCount,
                },
              }
            : group,
        ),
      },
      groupMemberships: {
        ...base.lanes.groupMemberships,
        groups: base.lanes.groupMemberships.groups.map((group) =>
          group.groupId === groupId
            ? { ...group, stateHash: groupHead.stateHash }
            : group,
        ),
      },
      organizationPolicy: {
        organizationId,
        currentState: {
          stateHash: organizationHead.stateHash,
          version: organizationHead.version,
          keyEpoch: organizationHead.keyEpoch,
          keyFingerprint: organizationHead.keyFingerprint,
          memberCount: organizationHead.memberCount,
        },
      },
    },
  };
}

async function savePresentationState(execSql: ExecSql): Promise<void> {
  await ensureContainerTables(execSql);
  await applyOrganizationReadModelResponse({
    currentUserId: requesterUserId,
    execSql,
    requestedCursor: null,
    response: presentationSnapshot(),
  });
  await savePrincipalPolicyBundle(execSql, groupPolicyBundle(), persistedAt);
  await savePrincipalPolicyBundle(
    execSql,
    organizationPrincipalPolicy,
    persistedAt,
  );
  await reconcileOrganizationDataUsage({
    apiClient: {
      getOrganizationDataUsageResult: async () => ({
        data: dataUsage,
        ok: true,
      }),
    },
    execSql,
    organizationId,
    requesterUserId,
  });
}

async function loadPresentationState(execSql: ExecSql) {
  const common = { currentUserId: requesterUserId, execSql, organizationId };
  return {
    directory: await loadLocalOrganizationDirectoryAndGroups(common),
    grants: await loadLocalOrganizationContainerGrants(common),
    groupContainers: await loadLocalOrganizationGroupContainers({
      ...common,
      groupId,
    }),
    groupMembers: await loadLocalOrganizationGroupMembers({
      ...common,
      groupId,
    }),
    groupPolicyHistory: await loadLocalOrganizationGroupPolicyHistory({
      ...common,
      groupId,
    }),
    organizationPolicyHistory: await loadLocalOrganizationPolicyHistory(common),
    policyReference: await loadLocalOrganizationPolicyReference({
      ...common,
      principalId: organizationId,
      principalType: "organization",
    }),
    userDetail: await loadLocalOrganizationUserDetail({
      ...common,
      userId: targetUserId,
    }),
  };
}

function nullPresentationKeys(
  values: Awaited<ReturnType<typeof loadPresentationState>>,
): string[] {
  return Object.entries(values).flatMap(([key, value]) =>
    value === null ? [key] : [],
  );
}

test("read-model denial hides all presentation reads when purge fails", async () => {
  const testDb = await createTestExecSql(
    "organization-presentation-purge-failure",
  );
  let rejectReadModelDelete = false;
  const execSql = createRejectingExecSql(
    testDb.execSql,
    (sql) =>
      rejectReadModelDelete &&
      sql.includes('delete from "organization_read_model_state"'),
  );
  const errors: unknown[][] = [];

  try {
    await savePresentationState(execSql);
    expect(nullPresentationKeys(await loadPresentationState(execSql))).toEqual(
      [],
    );
    rejectReadModelDelete = true;

    await expect(
      reconcileOrganizationDirectoryAndGroups({
        apiClient: {
          getOrganizationReadModelResult: async () =>
            organizationReadModelFailure({
              code: ORGANIZATION_PRESENTATION_ERROR_CODES.accessDenied,
              kind: "http",
              status: 403,
            }),
        },
        currentUserId: requesterUserId,
        execSql,
        logError: (...args) => errors.push(args),
        organizationId,
      }),
    ).resolves.toBeNull();
    const hidden = await loadPresentationState(execSql);
    expect(nullPresentationKeys(hidden)).toEqual(Object.keys(hidden));
    await expect(
      loadLocalOrganizationDataUsage({
        execSql,
        organizationId,
        requesterUserId,
      }),
    ).resolves.toBeNull();
    await expect(
      loadOrganizationReadModelProjection(
        execSql,
        organizationId,
        requesterUserId,
      ),
    ).resolves.not.toBeNull();
    await expect(
      loadOrganizationDataUsageProjection(
        execSql,
        organizationId,
        requesterUserId,
      ),
    ).resolves.toEqual(dataUsage);
    expect(errors[0]?.[0]).toBe("Failed to purge denied organization access");

    rejectReadModelDelete = false;
    let requestedCursor: string | undefined = "not-requested";
    await expect(
      reconcileOrganizationDirectoryAndGroups({
        apiClient: {
          getOrganizationReadModelResult: async (_organizationId, cursor) => {
            requestedCursor = cursor;
            return { data: presentationSnapshot("cursor-restored"), ok: true };
          },
        },
        currentUserId: requesterUserId,
        execSql,
        organizationId,
      }),
    ).resolves.not.toBeNull();
    expect(requestedCursor).toBeUndefined();
    expect(nullPresentationKeys(await loadPresentationState(execSql))).toEqual(
      [],
    );
    await expect(
      loadLocalOrganizationDataUsage({
        execSql,
        organizationId,
        requesterUserId,
      }),
    ).resolves.toBeNull();
    await expect(
      reconcileOrganizationDataUsage({
        apiClient: {
          getOrganizationDataUsageResult: async () => ({
            data: dataUsage,
            ok: true,
          }),
        },
        execSql,
        organizationId,
        requesterUserId,
      }),
    ).resolves.toEqual(dataUsage);
  } finally {
    testDb.close();
  }
});

test("a delayed pre-denial read-model response cannot apply or restore", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-presentation-delayed-response",
  );
  let resolveRequest: (
    result: RequestResult<OrganizationReadModelResponse>,
  ) => void = () => {};
  let signalRequestStarted = () => {};
  const requestStarted = new Promise<void>((resolve) => {
    signalRequestStarted = resolve;
  });
  const pendingRequest = new Promise<
    RequestResult<OrganizationReadModelResponse>
  >((resolve) => {
    resolveRequest = resolve;
  });

  try {
    await applyOrganizationReadModelResponse({
      currentUserId: requesterUserId,
      execSql,
      requestedCursor: null,
      response: organizationReadModelSnapshot(),
    });
    const delayed = reconcileOrganizationDirectoryAndGroups({
      apiClient: {
        getOrganizationReadModelResult: async () => {
          signalRequestStarted();
          return pendingRequest;
        },
      },
      currentUserId: requesterUserId,
      execSql,
      organizationId,
    });
    await requestStarted;
    await expect(
      reconcileOrganizationDirectoryAndGroups({
        apiClient: {
          getOrganizationReadModelResult: async () =>
            organizationReadModelFailure({
              code: ORGANIZATION_PRESENTATION_ERROR_CODES.accessDenied,
              kind: "http",
              status: 404,
            }),
        },
        currentUserId: requesterUserId,
        execSql,
        organizationId,
      }),
    ).resolves.toBeNull();

    resolveRequest({
      data: organizationReadModelGroupsDelta({
        cursor: "cursor-delayed",
        groupName: "Delayed",
      }),
      ok: true,
    });
    await expect(delayed).resolves.toBeNull();
    await expect(
      loadOrganizationReadModelProjection(
        execSql,
        organizationId,
        requesterUserId,
      ),
    ).resolves.toBeNull();

    await expect(
      reconcileOrganizationDirectoryAndGroups({
        apiClient: {
          getOrganizationReadModelResult: async () => ({
            data: organizationReadModelSnapshot({
              cursor: "cursor-fresh",
              groupName: "Restored",
            }),
            ok: true,
          }),
        },
        currentUserId: requesterUserId,
        execSql,
        organizationId,
      }),
    ).resolves.toMatchObject({ groups: [{ name: "Restored" }] });
    await expect(
      loadLocalOrganizationDirectoryAndGroups({
        currentUserId: requesterUserId,
        execSql,
        organizationId,
      }),
    ).resolves.toMatchObject({ groups: [{ name: "Restored" }] });
  } finally {
    close();
  }
});

test("presentation reads recheck access after asynchronous loading", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-presentation-read-race",
  );
  let releaseRead = () => {};
  let signalReadStarted = () => {};
  const readStarted = new Promise<void>((resolve) => {
    signalReadStarted = resolve;
  });
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const accessInput = { execSql, organizationId, requesterUserId };

  try {
    const read = runOrganizationPresentationRead(
      accessInput,
      "readModel",
      async () => {
        signalReadStarted();
        await readGate;
        return "stale presentation";
      },
    );
    await readStarted;
    denyOrganizationPresentationAccess(accessInput, ["readModel"]);
    releaseRead();
    await expect(read).resolves.toBeNull();
  } finally {
    close();
  }
});
