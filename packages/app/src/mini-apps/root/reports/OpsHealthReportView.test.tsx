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
    expect(
      view.getByText(
        "Trigger count_document_updates is active on document_updates.",
      ),
    ).toBeTruthy();
    expect(
      view.getByText("No document update-count drift detected."),
    ).toBeTruthy();
    fireEvent.click(
      within(seatSync).getByText(
        ROOT_TEST_ORGANIZATION.organization.organizationId,
      ),
    );
    expect(
      view.getByRole("tab", { name: "Billing" }).getAttribute("aria-selected"),
    ).toBe("true");
    await clickRootToolbarButton(view, "Back");
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
    await clickRootToolbarButton(view, "Refresh");
    await view.findByRole("table", { name: "Seat sync" });
  } finally {
    report.mockRestore();
    restore();
  }
});

test("ops health surfaces missing update-count trigger, drifted documents, and truncation", async () => {
  const { restore, view, tearleads } = await renderRootWithSession(true);
  const report = spyOn(tearleads.root, "loadOpsHealthReport");
  const empty = { rows: [], truncated: false };
  report.mockResolvedValueOnce({
    ok: true,
    data: {
      generatedAt: "2026-10-22T12:00:00.000Z",
      seatSync: empty,
      trialExpiry: empty,
      purges: empty,
      trialsEnding: empty,
      purgesDue: empty,
      documentUpdateCounts: {
        triggerPresent: false,
        rows: [
          {
            documentId: "doc-drifted-1",
            storedCount: 2,
            actualCount: 5,
          },
        ],
        truncated: true,
      },
    },
  });
  try {
    await openRootReport(view, "Operations health");
    await view.findByText(
      "Trigger count_document_updates is missing or disabled on document_updates.",
    );
    const table = view.getByRole("table", { name: "Document update counts" });
    expect(within(table).getByText("doc-drifted-1")).toBeTruthy();
    expect(within(table).getByText("2")).toBeTruthy();
    expect(within(table).getByText("5")).toBeTruthy();
    expect(
      view.getByText("Showing the first 1 documents; more match."),
    ).toBeTruthy();
  } finally {
    report.mockRestore();
    restore();
  }
});
