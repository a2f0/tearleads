import { afterEach, expect, test } from "bun:test";
import type { OrganizationBillingHistoryEntry } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import { ORG_MANAGER_LABELS } from "../labels";
import { BillingHistory } from "./BillingHistory";

afterEach(() => cleanup());

function entry(
  overrides: Partial<OrganizationBillingHistoryEntry>,
): OrganizationBillingHistoryEntry {
  return {
    eventType: "INITIAL_PURCHASE",
    outcome: "applied",
    occurredAt: "2026-07-01T12:00:00.000Z",
    productId: null,
    transactionId: null,
    ...overrides,
  };
}

const ENTRIES: ReadonlyArray<OrganizationBillingHistoryEntry> = [
  entry({
    eventType: "RENEWAL",
    occurredAt: "2026-07-10T12:00:00.000Z",
    productId: "sync_monthly",
    transactionId: "transaction-2",
  }),
  entry({
    eventType: "CANCELLATION",
    outcome: "ignored",
    occurredAt: "2026-07-05T12:00:00.000Z",
  }),
  entry({
    eventType: "INITIAL_PURCHASE",
    occurredAt: "2026-07-01T12:00:00.000Z",
    productId: "sync_monthly",
    transactionId: "transaction-1",
  }),
];

test("renders both tabs with the activity tab selected", () => {
  const view = render(
    <BillingHistory entries={ENTRIES} error={null} loading={false} />,
  );
  const activityTab = view.getByRole("tab", {
    name: ORG_MANAGER_LABELS.billingHistoryActivityTab,
  });
  const eventsTab = view.getByRole("tab", {
    name: ORG_MANAGER_LABELS.billingHistoryEventsTab,
  });
  expect(activityTab.getAttribute("aria-selected")).toBe("true");
  expect(eventsTab.getAttribute("aria-selected")).toBe("false");
});

test("the activity tab shows friendly labels for applied events only", () => {
  const view = render(
    <BillingHistory entries={ENTRIES} error={null} loading={false} />,
  );
  expect(view.getByText("Renewed")).toBeDefined();
  expect(view.getByText("Subscription started")).toBeDefined();
  expect(
    view.getByText(formatMiniAppDateTime("2026-07-10T12:00:00.000Z")),
  ).toBeDefined();
  // The ignored cancellation changed nothing, so it is not activity.
  expect(view.queryByText("Cancellation scheduled")).toBeNull();
  // Raw event types belong to the events tab.
  expect(view.queryByText("RENEWAL")).toBeNull();
  expect(view.queryByText("INITIAL_PURCHASE")).toBeNull();
});

test("switching to the events tab shows every raw event and its outcome", () => {
  const view = render(
    <BillingHistory entries={ENTRIES} error={null} loading={false} />,
  );
  fireEvent.click(
    view.getByRole("tab", {
      name: ORG_MANAGER_LABELS.billingHistoryEventsTab,
    }),
  );
  expect(
    view
      .getByRole("tab", { name: ORG_MANAGER_LABELS.billingHistoryEventsTab })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(view.getByText("RENEWAL")).toBeDefined();
  expect(view.getByText("CANCELLATION")).toBeDefined();
  expect(view.getByText("INITIAL_PURCHASE")).toBeDefined();
  expect(view.getAllByText("applied")).toHaveLength(2);
  expect(view.getAllByText("ignored")).toHaveLength(1);
  expect(
    view.getByText(formatMiniAppDateTime("2026-07-05T12:00:00.000Z")),
  ).toBeDefined();
  // Friendly labels belong to the activity tab.
  expect(view.queryByText("Renewed")).toBeNull();

  // Switching back restores the friendly activity view.
  fireEvent.click(
    view.getByRole("tab", {
      name: ORG_MANAGER_LABELS.billingHistoryActivityTab,
    }),
  );
  expect(view.getByText("Renewed")).toBeDefined();
  expect(view.queryByText("RENEWAL")).toBeNull();
});

test("an unknown event type falls back to a title-cased label", () => {
  const view = render(
    <BillingHistory
      entries={[entry({ eventType: "BILLING_ISSUE" })]}
      error={null}
      loading={false}
    />,
  );
  expect(view.getByText("Billing issue")).toBeDefined();
});

test("shows the empty state on both tabs when there are no events", () => {
  const view = render(
    <BillingHistory entries={[]} error={null} loading={false} />,
  );
  expect(view.getByText(ORG_MANAGER_LABELS.billingHistoryEmpty)).toBeDefined();
  fireEvent.click(
    view.getByRole("tab", {
      name: ORG_MANAGER_LABELS.billingHistoryEventsTab,
    }),
  );
  expect(view.getByText(ORG_MANAGER_LABELS.billingHistoryEmpty)).toBeDefined();
});

test("the activity tab shows the empty state when nothing was applied", () => {
  const view = render(
    <BillingHistory
      entries={[entry({ eventType: "CANCELLATION", outcome: "ignored" })]}
      error={null}
      loading={false}
    />,
  );
  expect(view.getByText(ORG_MANAGER_LABELS.billingHistoryEmpty)).toBeDefined();
  fireEvent.click(
    view.getByRole("tab", {
      name: ORG_MANAGER_LABELS.billingHistoryEventsTab,
    }),
  );
  expect(view.getByText("CANCELLATION")).toBeDefined();
});

test("shows a loading hint before the history resolves", () => {
  const view = render(
    <BillingHistory entries={null} error={null} loading={true} />,
  );
  expect(
    view.getByText(ORG_MANAGER_LABELS.loadingBillingHistory),
  ).toBeDefined();
});

test("shows the load error instead of the lists", () => {
  const view = render(
    <BillingHistory
      entries={null}
      error={ORG_MANAGER_LABELS.failedLoadBillingHistory}
      loading={false}
    />,
  );
  expect(
    view.getByText(ORG_MANAGER_LABELS.failedLoadBillingHistory),
  ).toBeDefined();
  expect(view.queryByText(ORG_MANAGER_LABELS.billingHistoryEmpty)).toBeNull();
});
