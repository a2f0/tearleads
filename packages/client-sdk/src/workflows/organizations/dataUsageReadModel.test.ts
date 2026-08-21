import { expect, test } from "bun:test";
import type { RequestFailure } from "@symcrypt/api-client";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  dataUsage,
  organizationId,
} from "../../../test/helpers/organizationReadModelFixtures";
import {
  loadLocalOrganizationDataUsage,
  reconcileOrganizationDataUsage,
} from "./dataUsageReadModel";

const REQUESTER_USER_ID = "user-1";

function requestFailure(input: {
  readonly report: () => void;
  readonly status: number | null;
}): RequestFailure {
  return {
    kind: input.status === null ? "network" : "http",
    message: "usage request failed",
    method: "GET",
    ok: false,
    path: `/organizations/${organizationId}/data-usage`,
    report: input.report,
    status: input.status,
    statusText: input.status === null ? "" : "failure",
  };
}

test("organization data usage reconciles into the local projection", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-data-usage-reconcile",
  );
  try {
    const result = await reconcileOrganizationDataUsage({
      apiClient: {
        getOrganizationDataUsageResult: async () => ({
          data: dataUsage,
          ok: true,
        }),
      },
      execSql,
      organizationId,
      requesterUserId: REQUESTER_USER_ID,
    });

    expect(result).toEqual(dataUsage);
    await expect(
      loadLocalOrganizationDataUsage({
        execSql,
        organizationId,
        requesterUserId: REQUESTER_USER_ID,
      }),
    ).resolves.toEqual(dataUsage);
  } finally {
    close();
  }
});

test("transient usage failures report once and retain last-known-good data", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-data-usage-retained",
  );
  try {
    await reconcileOrganizationDataUsage({
      apiClient: {
        getOrganizationDataUsageResult: async () => ({
          data: dataUsage,
          ok: true,
        }),
      },
      execSql,
      organizationId,
      requesterUserId: REQUESTER_USER_ID,
    });
    let reportCount = 0;

    const result = await reconcileOrganizationDataUsage({
      apiClient: {
        getOrganizationDataUsageResult: async () =>
          requestFailure({
            report: () => {
              reportCount += 1;
            },
            status: null,
          }),
      },
      execSql,
      organizationId,
      requesterUserId: REQUESTER_USER_ID,
    });

    expect(result).toEqual(dataUsage);
    expect(reportCount).toBe(1);
  } finally {
    close();
  }
});

for (const status of [403, 404] as const) {
  test(`authoritative usage failure ${status} purges the requester projection`, async () => {
    const { close, execSql } = await createTestExecSql(
      `organization-data-usage-purge-${status}`,
    );
    try {
      await reconcileOrganizationDataUsage({
        apiClient: {
          getOrganizationDataUsageResult: async () => ({
            data: dataUsage,
            ok: true,
          }),
        },
        execSql,
        organizationId,
        requesterUserId: REQUESTER_USER_ID,
      });

      await expect(
        reconcileOrganizationDataUsage({
          apiClient: {
            getOrganizationDataUsageResult: async () =>
              requestFailure({ report: () => {}, status }),
          },
          execSql,
          organizationId,
          requesterUserId: REQUESTER_USER_ID,
        }),
      ).resolves.toBeNull();
      await expect(
        loadLocalOrganizationDataUsage({
          execSql,
          organizationId,
          requesterUserId: REQUESTER_USER_ID,
        }),
      ).resolves.toBeNull();
    } finally {
      close();
    }
  });
}

test("a response for another organization cannot replace local usage", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-data-usage-scope",
  );
  try {
    await reconcileOrganizationDataUsage({
      apiClient: {
        getOrganizationDataUsageResult: async () => ({
          data: dataUsage,
          ok: true,
        }),
      },
      execSql,
      organizationId,
      requesterUserId: REQUESTER_USER_ID,
    });
    const errors: unknown[] = [];

    const result = await reconcileOrganizationDataUsage({
      apiClient: {
        getOrganizationDataUsageResult: async () => ({
          data: { ...dataUsage, organizationId: "org-other" },
          ok: true,
        }),
      },
      execSql,
      logError: (...args) => errors.push(args),
      organizationId,
      requesterUserId: REQUESTER_USER_ID,
    });

    expect(result).toEqual(dataUsage);
    expect(errors).toHaveLength(1);
  } finally {
    close();
  }
});
