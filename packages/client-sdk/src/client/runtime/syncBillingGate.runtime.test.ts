import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { Tearleads } from "../../Tearleads";
import { getOrCreateOrganizationSyncPauses } from "../../workflows/sync";

test("a payment block in one organization does not stop another organization", () => {
  const sdk = new Tearleads({ online: true });
  // The active session can remain on the custom org while a mixed-org store
  // syncs a personal-org resource, so the predicate must use its argument.
  sdk.session.setOrganizationId("custom-org");
  sdk.syncBillingGate.notifyPaymentRequired("custom-org");

  const isRemoteSyncBlocked = sdk.runtime.input().util.isRemoteSyncBlocked;
  expect(isRemoteSyncBlocked?.("personal-org")).toBe(false);
  expect(isRemoteSyncBlocked?.("custom-org")).toBe(true);
});

test("a payment block holds an organization's writes but not its pulls", () => {
  const sdk = new Tearleads({ online: true });
  sdk.syncBillingGate.notifyPaymentRequired("lapsed-org");

  const isRemoteSyncBlocked = sdk.runtime.input().util.isRemoteSyncBlocked;
  expect(isRemoteSyncBlocked?.("lapsed-org", "push")).toBe(true);
  expect(isRemoteSyncBlocked?.("lapsed-org", "pull")).toBe(false);
});

test("a sync pause holds one organization in both directions until resumed", async () => {
  const sdk = new Tearleads({ online: true });
  const { close, execSql } = await createTestExecSql("runtime-sync-pause");
  try {
    const pauses = getOrCreateOrganizationSyncPauses(sdk.domainScope);
    const isRemoteSyncBlocked = sdk.runtime.input().util.isRemoteSyncBlocked;

    await pauses.replace(execSql, ["paused-org"]);
    expect(isRemoteSyncBlocked?.("paused-org")).toBe(true);
    expect(isRemoteSyncBlocked?.("paused-org", "pull")).toBe(true);
    expect(isRemoteSyncBlocked?.("other-org")).toBe(false);
    expect(isRemoteSyncBlocked?.("other-org", "pull")).toBe(false);

    await pauses.replace(execSql, []);
    expect(isRemoteSyncBlocked?.("paused-org")).toBe(false);
    expect(isRemoteSyncBlocked?.("paused-org", "pull")).toBe(false);
  } finally {
    close();
  }
});
