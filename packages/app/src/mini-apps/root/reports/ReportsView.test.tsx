import "../../../../test/helpers/msw/server";
import { afterEach, expect, spyOn, test } from "bun:test";
import { fireEvent, within } from "@testing-library/react";
import { cleanupIdentityManagerTestEnvironment } from "../../../../test/helpers/identityManagerTestRuntime";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../../test/helpers/msw/server";
import {
  clickRootToolbarButton,
  renderRootWithSession,
  rootToolbar,
} from "../../../../test/helpers/renderRootConsole";
import { ROOT_REPORTS } from "./rootReports";

afterEach(async () => {
  await cleanupIdentityManagerTestEnvironment();
}, MOCK_SERVER_RESET_TIMEOUT_MS);

test("Reports lists every report without loading one, and each row drills in and back", async () => {
  const { restore, tearleads, view } = await renderRootWithSession(true);
  const loads = [
    spyOn(tearleads.root, "loadOpsHealthReport"),
    spyOn(tearleads.root, "listRevenuecatEventsReport"),
    spyOn(tearleads.root, "listDataUsageReport"),
    spyOn(tearleads.root, "listPendingBlobDeletions"),
  ];
  try {
    fireEvent.click(view.getByRole("button", { name: "Reports" }));
    for (const report of ROOT_REPORTS) {
      const listing = await view.findByRole("table", { name: "Reports" });
      const body = listing.querySelector("tbody");
      if (!body) throw new Error("Expected a reports table body.");
      expect(
        within(body)
          .getAllByRole("row")
          .map((row) => row.querySelector("button")?.textContent),
      ).toEqual(ROOT_REPORTS.map(({ label }) => label));
      expect(rootToolbar(view).queryByRole("button", { name: "Back" })).toBe(
        null,
      );

      // Anywhere on the row opens it, not only its name.
      fireEvent.click(within(body).getByText(report.description));
      await view.findByRole("heading", { name: report.label });
      expect(view.queryByRole("table", { name: "Reports" })).toBeNull();
      await clickRootToolbarButton(view, "Back");
    }
    await view.findByRole("table", { name: "Reports" });
    // The listing itself requests nothing; each report loaded once, on open.
    for (const load of loads) expect(load).toHaveBeenCalledTimes(1);
  } finally {
    for (const load of loads) load.mockRestore();
    restore();
  }
});
