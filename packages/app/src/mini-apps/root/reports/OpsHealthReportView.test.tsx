import "../../../../test/helpers/msw/server";
import { afterEach, expect, spyOn, test } from "bun:test";
import { fireEvent, within } from "@testing-library/react";
import { cleanupIdentityManagerTestEnvironment } from "../../../../test/helpers/identityManagerTestRuntime";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../../test/helpers/msw/server";
import {
  clickRootToolbarButton,
  openRootReport,
  renderRootWithSession,
} from "../../../../test/helpers/renderRootConsole";
import { ROOT_TEST_ORGANIZATION } from "../../../../test/helpers/rootConsoleFixtures";

afterEach(async () => {
  await cleanupIdentityManagerTestEnvironment();
}, MOCK_SERVER_RESET_TIMEOUT_MS);

test("ops health lists maintenance trouble and opens an organization's billing", async () => {
  const { restore, view } = await renderRootWithSession(true);
  try {
    await openRootReport(view, "Operations health");
    const seatSync = await view.findByRole("table", { name: "Seat sync" });
    await within(seatSync).findByText("Failing, Lease lapsed");
    expect(within(seatSync).getByText("3 / 5")).toBeTruthy();
    expect(
      within(seatSync).getByText("Stripe rejected the quantity"),
    ).toBeTruthy();
    expect(
      view.getByText("Showing the first 1 organizations; more match."),
    ).toBeTruthy();
    const trials = view.getByRole("table", { name: "Trial expiry" });
    expect(within(trials).getByText("8 (needs attention)")).toBeTruthy();
    const purges = view.getByRole("table", { name: "Purges" });
    expect(within(purges).getByText("Claim lapsed")).toBeTruthy();
    expect(view.getByText("No trials end soon.")).toBeTruthy();
    expect(view.getByText("No purges fall due soon.")).toBeTruthy();
    fireEvent.click(
      within(seatSync).getByText(
        ROOT_TEST_ORGANIZATION.organization.organizationId,
      ),
    );
    expect(
      view.getByRole("tab", { name: "Billing" }).getAttribute("aria-selected"),
    ).toBe("true");
    clickRootToolbarButton(view, "Back");
    await view.findByRole("table", { name: "Seat sync" });
  } finally {
    restore();
  }
});

test("an ops health failure shows an error and refresh can recover", async () => {
  const { restore, view, tearleads } = await renderRootWithSession(true);
  const report = spyOn(tearleads.root, "loadOpsHealthReport");
  report.mockResolvedValueOnce({
    ok: false,
    status: 500,
    message: "Report temporarily unavailable",
  });
  try {
    await openRootReport(view, "Operations health");
    await view.findByText("Report temporarily unavailable");
    expect(view.queryByRole("table", { name: "Seat sync" })).toBeNull();
    clickRootToolbarButton(view, "Refresh");
    await view.findByRole("table", { name: "Seat sync" });
  } finally {
    report.mockRestore();
    restore();
  }
});
