import { expect, test } from "bun:test";
import type { RequestResult } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import type { OrganizationMembershipResponse } from "@tearleads/validators/response";
import { createDomainScope } from "../../../data/shared/domainScope";
import { getOrCreateOrganizationSyncPauses } from "../../sync";
import {
  type OrganizationContentHost,
  type OrganizationMembershipApi,
  refreshOrganizationMemberships,
  setOrganizationSyncPaused,
} from "./organizationMemberships";

function membership(
  organizationId: string,
  syncPaused: boolean,
): OrganizationMembershipResponse {
  return { isPersonalOrganizationOwner: false, organizationId, syncPaused };
}

function createHost(unsynced: Set<string> = new Set()) {
  const calls: string[] = [];
  const host: OrganizationContentHost = {
    async flushWrites() {
      calls.push("flush");
    },
    async forgetOrganizationContent(organizationId) {
      calls.push(`forget:${organizationId}`);
      return true;
    },
    async hasUnsyncedOrganizationWrites(organizationId) {
      return unsynced.has(organizationId);
    },
    async refetchContent() {
      calls.push("refetch");
    },
  };
  return { calls, host };
}

function createApi(
  memberships: OrganizationMembershipResponse[] | null,
  update: RequestResult<OrganizationMembershipResponse> = {
    data: membership("org-a", true),
    ok: true,
  },
) {
  const updates: Array<{ organizationId: string; syncPaused: boolean }> = [];
  const apiClient: OrganizationMembershipApi = {
    async listOrganizationMemberships() {
      return memberships ? { memberships } : null;
    },
    async updateOrganizationMembership(organizationId, input) {
      updates.push({ organizationId, syncPaused: input.syncPaused });
      return update;
    },
  };
  return { apiClient, updates };
}

async function withDatabase(
  run: (
    execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"],
  ) => Promise<void>,
): Promise<void> {
  const { close, execSql } = await createTestExecSql(
    "organization-memberships",
  );
  try {
    await run(execSql);
  } finally {
    close();
  }
}

test("a refresh applies pauses from other devices and keeps unsynced work", async () => {
  await withDatabase(async (execSql) => {
    const domainScope = createDomainScope();
    const { calls, host } = createHost(new Set(["org-busy"]));
    const { apiClient } = createApi([
      membership("org-a", true),
      membership("org-busy", true),
      membership("org-live", false),
    ]);

    const result = await refreshOrganizationMemberships({
      apiClient,
      domainScope,
      execSql,
      host,
    });

    expect(result?.map((row) => row.organizationId)).toEqual([
      "org-a",
      "org-busy",
      "org-live",
    ]);
    expect(
      [
        ...getOrCreateOrganizationSyncPauses(
          domainScope,
        ).pausedOrganizationIds(),
      ].sort(),
    ).toEqual(["org-a", "org-busy"]);
    // org-busy still has writes to upload, so its copy stays until a later pass.
    expect(calls).toEqual(["forget:org-a"]);
  });
});

test("a refresh that resumes an organization downloads it again", async () => {
  await withDatabase(async (execSql) => {
    const domainScope = createDomainScope();
    await getOrCreateOrganizationSyncPauses(domainScope).replace(execSql, [
      "org-a",
    ]);
    const { calls, host } = createHost();
    const { apiClient } = createApi([membership("org-a", false)]);

    await refreshOrganizationMemberships({
      apiClient,
      domainScope,
      execSql,
      host,
    });

    expect(calls).toEqual(["refetch"]);
  });
});

test("an unavailable list leaves the persisted pauses in force", async () => {
  await withDatabase(async (execSql) => {
    const domainScope = createDomainScope();
    await getOrCreateOrganizationSyncPauses(domainScope).replace(execSql, [
      "org-a",
    ]);
    const { calls, host } = createHost();
    const { apiClient } = createApi(null);

    expect(
      await refreshOrganizationMemberships({
        apiClient,
        domainScope,
        execSql,
        host,
      }),
    ).toBeNull();
    expect(
      getOrCreateOrganizationSyncPauses(domainScope).isOrganizationPaused(
        "org-a",
      ),
    ).toBe(true);
    expect(calls).toEqual([]);
  });
});

test("pausing is refused while the organization has unsynced writes", async () => {
  await withDatabase(async (execSql) => {
    const domainScope = createDomainScope();
    const { calls, host } = createHost(new Set(["org-a"]));
    const { apiClient, updates } = createApi([]);

    const result = await setOrganizationSyncPaused({
      apiClient,
      domainScope,
      execSql,
      host,
      organizationId: "org-a",
      paused: true,
    });

    expect(result).toEqual({ status: "unsynced-writes" });
    expect(updates).toEqual([]);
    expect(calls).toEqual(["flush"]);
    expect(
      getOrCreateOrganizationSyncPauses(domainScope).isOrganizationPaused(
        "org-a",
      ),
    ).toBe(false);
  });
});

test("pausing records the choice and then removes the local copy", async () => {
  await withDatabase(async (execSql) => {
    const domainScope = createDomainScope();
    const { calls, host } = createHost();
    const { apiClient, updates } = createApi([]);

    const result = await setOrganizationSyncPaused({
      apiClient,
      domainScope,
      execSql,
      host,
      organizationId: "org-a",
      paused: true,
    });

    expect(result.status).toBe("updated");
    expect(updates).toEqual([{ organizationId: "org-a", syncPaused: true }]);
    expect(calls).toEqual(["flush", "forget:org-a"]);
    expect(
      getOrCreateOrganizationSyncPauses(domainScope).isOrganizationPaused(
        "org-a",
      ),
    ).toBe(true);
  });
});

test("a rejected change leaves this device untouched", async () => {
  await withDatabase(async (execSql) => {
    const domainScope = createDomainScope();
    const { calls, host } = createHost();
    const { apiClient } = createApi([], {
      kind: "http",
      message: "A personal organization cannot be paused",
      method: "PUT",
      ok: false,
      path: "/organization-memberships/org-a",
      report: () => undefined,
      status: 409,
      statusText: "Conflict",
    });

    const result = await setOrganizationSyncPaused({
      apiClient,
      domainScope,
      execSql,
      host,
      organizationId: "org-a",
      paused: true,
    });

    expect(result).toEqual({
      httpStatus: 409,
      message: "A personal organization cannot be paused",
      status: "failed",
    });
    expect(calls).toEqual(["flush"]);
    expect(
      getOrCreateOrganizationSyncPauses(domainScope).isOrganizationPaused(
        "org-a",
      ),
    ).toBe(false);
  });
});

test("resuming records the choice and downloads the organization again", async () => {
  await withDatabase(async (execSql) => {
    const domainScope = createDomainScope();
    await getOrCreateOrganizationSyncPauses(domainScope).replace(execSql, [
      "org-a",
    ]);
    const { calls, host } = createHost();
    const { apiClient, updates } = createApi([], {
      data: membership("org-a", false),
      ok: true,
    });

    await setOrganizationSyncPaused({
      apiClient,
      domainScope,
      execSql,
      host,
      organizationId: "org-a",
      paused: false,
    });

    expect(updates).toEqual([{ organizationId: "org-a", syncPaused: false }]);
    expect(calls).toEqual(["refetch"]);
    expect(
      getOrCreateOrganizationSyncPauses(domainScope).isOrganizationPaused(
        "org-a",
      ),
    ).toBe(false);
  });
});
