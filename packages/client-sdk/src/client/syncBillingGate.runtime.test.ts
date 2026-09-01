import { expect, test } from "bun:test";
import { Tearleads } from "./Tearleads";

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
