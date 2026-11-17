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
  isPersonalOrganizationOwner = false,
): OrganizationMembershipResponse {
  return {
    isPersonalOrganizationOwner,
    leaveRequestedAt: null,
    organizationId,
    syncPaused,
  };
}

function createHost() {
  const calls: string[] = [];
  const host: OrganizationContentHost = {
    async resumeSync() {
      calls.push("resume");
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

test("a refresh applies pauses from other devices and keeps the local copy", async () => {
  await withDatabase(async (execSql) => {
    const domainScope = createDomainScope();
    const { calls, host } = createHost();
    const { apiClient } = createApi([
      membership("org-a", true),
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
      "org-live",
    ]);
    expect([
      ...getOrCreateOrganizationSyncPauses(domainScope).pausedOrganizationIds(),
    ]).toEqual(["org-a"]);
    // A pause only holds sync: nothing is removed and nothing is re-listed.
    expect(calls).toEqual([]);
  });
});

test("a personal organization paused elsewhere stays live on this device", async () => {
  await withDatabase(async (execSql) => {
    const domainScope = createDomainScope();
    const { calls, host } = createHost();
    const { apiClient } = createApi([membership("personal", true, true)]);

    await refreshOrganizationMemberships({
      apiClient,
      domainScope,
      execSql,
      host,
      isCurrent: () => true,
    });

    // A new device needs its personal organization to start, so a pause
    // chosen on another device never holds it here.
    expect(
      getOrCreateOrganizationSyncPauses(domainScope).isOrganizationPaused(
        "personal",
      ),
    ).toBe(false);
    expect(calls).toEqual([]);
  });
});

test("a personal organization paused on this device stays held until resumed", async () => {
  await withDatabase(async (execSql) => {
    const domainScope = createDomainScope();
    const { calls, host } = createHost();
    const { apiClient } = createApi([membership("personal", true, true)], {
      data: membership("personal", true, true),
      ok: true,
    });
    const input = {
      apiClient,
      domainScope,
      execSql,
      host,
      isCurrent: () => true,
    };

    await setOrganizationSyncPaused({
      ...input,
      organizationId: "personal",
      paused: true,
    });
    await refreshOrganizationMemberships(input);

    const pauses = getOrCreateOrganizationSyncPauses(domainScope);
    expect(pauses.isOrganizationPaused("personal")).toBe(true);

    // Resumed from any device, the next membership read lifts the hold.
    await refreshOrganizationMemberships({
      ...input,
      apiClient: createApi([membership("personal", false, true)]).apiClient,
    });

    expect(pauses.isOrganizationPaused("personal")).toBe(false);
    expect(calls).toEqual(["resume"]);
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

test("a refresh that resumes an organization catches its sync up", async () => {
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

    expect(calls).toEqual(["resume"]);
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

test("pausing records the choice and holds sync without touching the local copy", async () => {
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
    // Unsent writes do not have to upload first: they stay queued.
    expect(calls).toEqual([]);
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
      message: "Membership not found",
      method: "PUT",
      ok: false,
      path: "/organization-memberships/org-a",
      report: () => undefined,
      status: 404,
      statusText: "Not Found",
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
      httpStatus: 404,
      message: "Membership not found",
      status: "failed",
    });
    expect(calls).toEqual([]);
    expect(
      getOrCreateOrganizationSyncPauses(domainScope).isOrganizationPaused(
        "org-a",
      ),
    ).toBe(false);
  });
});

test("resuming records the choice and catches the organization up", async () => {
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
    expect(calls).toEqual(["resume"]);
    expect(
      getOrCreateOrganizationSyncPauses(domainScope).isOrganizationPaused(
        "org-a",
      ),
    ).toBe(false);
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
