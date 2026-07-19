import { expect, test } from "bun:test";
import { loadLocalOrganizationDirectoryAndGroups } from "@tearleads/client-sdk";
import { createTestExecSql } from "@tearleads/test-utils";
import { subscribeOrganizationReadModelRealtime } from "./organizationReadModelRealtime";
import {
  createRuntimeHarness,
  ORGANIZATION_A,
} from "./test/organizationReadModelRealtimeHarness";

test("a load-path projection purge drops the lease and schedules a catch-up", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-invalidation-test",
  );
  let resolveReconcile = () => {};
  const reconciled = new Promise<void>((resolve) => {
    resolveReconcile = resolve;
  });
  const harness = createRuntimeHarness({
    execSql,
    loadDirectoryAndGroups: async () => {
      resolveReconcile();
      return {};
    },
  });
  const unsubscribe = subscribeOrganizationReadModelRealtime(
    harness.tearleads,
    ORGANIZATION_A,
    () => {},
  );

  try {
    const probe = {
      currentUserId: "prober",
      execSql,
      organizationId: ORGANIZATION_A,
    };
    // A clean load creates the tables and does not schedule anything.
    await expect(
      loadLocalOrganizationDirectoryAndGroups(probe),
    ).resolves.toBeNull();
    expect(harness.reconcileCalls).toBe(0);

    // A stored projection from an unsupported protocol purges on load; the
    // purge must invalidate the realtime lease and refetch authoritatively.
    await execSql(
      `INSERT INTO organization_read_model_state
         (organization_id, protocol_version, cursor, member_group_id, updated_at)
       VALUES (?, 999, 'cursor-stale', 'members-a', '2026-07-18T12:00:00.000Z')`,
      [ORGANIZATION_A],
    );
    await expect(
      loadLocalOrganizationDirectoryAndGroups(probe),
    ).resolves.toBeNull();
    await reconciled;
    expect(harness.reconcileCalls).toBe(1);
  } finally {
    unsubscribe();
    close();
  }
});
