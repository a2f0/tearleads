import "../../../../test/helpers/mswServer";
import { afterEach, expect, test } from "bun:test";
import { fireEvent, within } from "@testing-library/react";
import { cleanupIdentityManagerTestEnvironment } from "../../../../test/helpers/identityManagerTestRuntime";
import { renderRootWithSession } from "../../../../test/helpers/renderRootConsole";
import {
  ROOT_TEST_IDENTITIES,
  ROOT_TEST_ORGANIZATION,
} from "../../../../test/helpers/rootConsoleFixtures";

const REPORT_HEADING = "Reports · RevenueCat webhooks needing attention";
const organizationId = ROOT_TEST_ORGANIZATION.organization.organizationId;

afterEach(async () => {
  await cleanupIdentityManagerTestEnvironment();
});

async function openReport(
  view: Awaited<ReturnType<typeof renderRootWithSession>>["view"],
) {
  fireEvent.click(view.getByRole("button", { name: "Reports" }));
  const heading = await view.findByRole("heading", { name: REPORT_HEADING });
  const section = heading.closest("section");
  if (!section) throw new Error("Expected the RevenueCat report section");
  return within(section);
}

test("the RevenueCat report filters by disposition and opens the buyer", async () => {
  const { restore, view } = await renderRootWithSession(true);
  const buyer = ROOT_TEST_IDENTITIES[1];
  if (!buyer) throw new Error("Expected a buyer identity fixture");
  try {
    const report = await openReport(view);
    await report.findByText(/INITIAL_PURCHASE · applied · no organization/);
    expect(report.getByText(/RENEWAL · ignored/)).toBeTruthy();
    // An anonymous App User ID names no identity, so only real buyers link.
    expect(
      report.queryAllByRole("button", { name: /Open buyer identity/ }),
    ).toHaveLength(1);

    fireEvent.change(
      report.getByRole("combobox", { name: "Deliveries to list" }),
      {
        target: { value: "unmatched" },
      },
    );
    await report.findByText(/INITIAL_PURCHASE/);
    expect(report.queryByText(/RENEWAL · ignored/)).toBeNull();

    fireEvent.click(
      report.getByRole("button", {
        name: `Open buyer identity ${buyer.userId}`,
      }),
    );
    await view.findByRole("table", { name: "Identity" });
    fireEvent.click(view.getByRole("button", { name: "Back" }));
    await view.findByRole("heading", { name: REPORT_HEADING });
  } finally {
    restore();
  }
});

test("a reported delivery opens its organization's billing, with its webhooks", async () => {
  const { restore, view } = await renderRootWithSession(true);
  try {
    const report = await openReport(view);
    fireEvent.click(
      await report.findByRole("button", {
        name: `Open organization billing ${organizationId}`,
      }),
    );
    expect(
      view.getByRole("tab", { name: "Billing" }).getAttribute("aria-selected"),
    ).toBe("true");
    await view.findByText(/RENEWAL · applied/);
    expect(
      view.getByText(/TRANSFER · applied · transferred away/),
    ).toBeTruthy();
    expect(view.getByText("Moved from this organization")).toBeTruthy();

    // Billing tab -> buyer -> Back returns to the Billing tab, then to Reports.
    const buyer = ROOT_TEST_IDENTITIES[1];
    if (!buyer) throw new Error("Expected a buyer identity fixture");
    fireEvent.click(
      view.getAllByRole("button", {
        name: `Open buyer identity ${buyer.userId}`,
      })[0] as HTMLElement,
    );
    await view.findByRole("table", { name: "Identity" });
    fireEvent.click(view.getByRole("button", { name: "Back" }));
    await view.findByText(/RENEWAL · applied/);
    expect(
      view.getByRole("tab", { name: "Billing" }).getAttribute("aria-selected"),
    ).toBe("true");

    fireEvent.click(view.getByRole("button", { name: "Back" }));
    await view.findByRole("heading", { name: REPORT_HEADING });
  } finally {
    restore();
  }
});
