import "../../../../test/helpers/mswServer";
import { afterEach, expect, spyOn, test } from "bun:test";
import { fireEvent, within } from "@testing-library/react";
import { cleanupIdentityManagerTestEnvironment } from "../../../../test/helpers/identityManagerTestRuntime";
import { renderRootWithSession } from "../../../../test/helpers/renderRootConsole";

afterEach(async () => {
  await cleanupIdentityManagerTestEnvironment();
});

test("an action newer than the console shows its operation id", async () => {
  const { restore, tearleads, view } = await renderRootWithSession(true);
  const events = spyOn(tearleads.root, "listAuditEvents").mockResolvedValue({
    ok: true,
    data: {
      events: [
        {
          action: "root.identities.futureAction.put",
          actorSigningKeyFingerprint: "ab".repeat(32),
          actorUserId: "22222222-2222-4222-8222-222222222222",
          filter: null,
          id: "33333333-3333-4333-8333-333333333333",
          occurredAt: "2026-10-22T00:00:00.000Z",
          sourceIpAddress: "198.51.100.4",
          targetOrganizationId: null,
          targetUserId: "11111111-1111-4111-8111-111111111111",
        },
        {
          action: "root.reports.opsHealth.get",
          actorSigningKeyFingerprint: "ab".repeat(32),
          actorUserId: "22222222-2222-4222-8222-222222222222",
          filter: null,
          id: "44444444-4444-4444-8444-444444444444",
          occurredAt: "2026-10-21T00:00:00.000Z",
          sourceIpAddress: "198.51.100.4",
          targetOrganizationId: null,
          targetUserId: null,
        },
      ],
      nextCursor: null,
    },
  });
  try {
    fireEvent.click(view.getByRole("button", { name: "Audit" }));
    const table = await view.findByRole("table", { name: "Audit events" });
    expect(
      await within(table).findByText("root.identities.futureAction.put"),
    ).toBeTruthy();
    expect(
      within(table).getByText("Viewed operations health report"),
    ).toBeTruthy();
  } finally {
    events.mockRestore();
    restore();
  }
});
