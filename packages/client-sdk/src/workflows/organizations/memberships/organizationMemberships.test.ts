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

function createHost(
  unsynced: Set<string> = new Set(),
  session: { activeOrganizationId: string | null } = {
    activeOrganizationId: null,
  },
) {
  const calls: string[] = [];
  const retries: Array<() => Promise<boolean>> = [];
  const host: OrganizationContentHost = {
    async flushWrites() {
      calls.push("flush");
    },
    async forgetOrganizationContent(organizationId) {
      calls.push(`forget:${organizationId}`);
      return (
        !unsynced.has(organizationId) &&
        organizationId !== session.activeOrganizationId
      );
    },
    async hasUnsyncedOrganizationWrites(organizationId) {
      return unsynced.has(organizationId);
    },
    async refetchContent() {
      calls.push("refetch");
    },
    retryWhenWritesSettle(retry) {
      retries.push(retry);
    },
  };
  return { calls, host, retries };
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
    const unsynced = new Set(["org-busy"]);
    const { calls, host, retries } = createHost(unsynced);
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
      isCurrent: () => true,
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
    // org-busy still has writes to upload, so its copy stays and a retry
    // waits for the uploads to settle.
    expect(calls).toEqual(["forget:org-a", "forget:org-busy"]);
    expect(retries).toHaveLength(1);

    unsynced.clear();
    expect(await retries[0]?.()).toBe(true);
    expect(calls.slice(2)).toEqual(["forget:org-a", "forget:org-busy"]);
  });
});

test("a membership read that started before a pause cannot undo it", async () => {
  await withDatabase(async (execSql) => {
    const domainScope = createDomainScope();
    const { host } = createHost();
    const gate: { release?: () => void } = {};
    const apiClient: OrganizationMembershipApi = {
      listOrganizationMemberships: () =>
        new Promise((resolve) => {
          gate.release = () =>
            resolve({ memberships: [membership("org-a", false)] });
        }),
      async updateOrganizationMembership() {
        return { data: membership("org-a", true), ok: true };
      },
    };

    const staleRead = refreshOrganizationMemberships({
      apiClient,
      domainScope,
      execSql,
      host,
      isCurrent: () => true,
    });
    const pause = setOrganizationSyncPaused({
      apiClient,
      domainScope,
      execSql,
      host,
      isCurrent: () => true,
      organizationId: "org-a",
      paused: true,
    });
    while (!gate.release) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    // Answer the read only once the pause has applied, or plainly is waiting
    // behind it: an unserialized read would then overwrite the pause.
    await Promise.race([
      pause,
      new Promise((resolve) => setTimeout(resolve, 100)),
    ]);
    gate.release();
    await Promise.all([staleRead, pause]);

    expect(
      getOrCreateOrganizationSyncPauses(domainScope).isOrganizationPaused(
        "org-a",
      ),
    ).toBe(true);
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
      isCurrent: () => true,
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
        isCurrent: () => true,
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
      isCurrent: () => true,
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
      isCurrent: () => true,
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
      isCurrent: () => true,
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
      isCurrent: () => true,
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

test("a pause for the active workspace waits until the session leaves it", async () => {
  await withDatabase(async (execSql) => {
    const domainScope = createDomainScope();
    const session = { activeOrganizationId: "org-a" as string | null };
    const { calls, host, retries } = createHost(new Set(), session);
    const { apiClient } = createApi([membership("org-a", true)]);

    await refreshOrganizationMemberships({
      apiClient,
      domainScope,
      execSql,
      host,
      isCurrent: () => true,
    });
    expect(calls).toEqual(["forget:org-a"]);
    expect(retries).toHaveLength(1);

    session.activeOrganizationId = "org-b";
    expect(await retries[0]?.()).toBe(true);
  });
});

test("a membership read that finishes after the scope ended changes nothing", async () => {
  await withDatabase(async (execSql) => {
    const domainScope = createDomainScope();
    const { calls, host } = createHost();
    const { apiClient } = createApi([membership("org-a", true)]);

    expect(
      await refreshOrganizationMemberships({
        apiClient,
        domainScope,
        execSql,
        host,
        isCurrent: () => false,
      }),
    ).toBeNull();
    expect(calls).toEqual([]);
    expect(
      getOrCreateOrganizationSyncPauses(domainScope).isOrganizationPaused(
        "org-a",
      ),
    ).toBe(false);
  });
});

test("a pause queued past an identity switch never reaches the server", async () => {
  await withDatabase(async (execSql) => {
    const domainScope = createDomainScope();
    const { calls, host } = createHost();
    const { apiClient, updates } = createApi([]);

    const result = await setOrganizationSyncPaused({
      apiClient,
      domainScope,
      execSql,
      host,
      isCurrent: () => false,
      organizationId: "org-a",
      paused: false,
    });

    expect(result.status).toBe("failed");
    expect(updates).toEqual([]);
    expect(calls).toEqual([]);
  });
});
