import { afterEach, expect, mock, test } from "bun:test";
import {
  SystemTray,
  type SystemTrayDefinition,
  SystemTrayProvider,
} from "@tearleads/windowing";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  SyncStatusIndicatorView,
  SyncStatusPopover,
  SyncStatusTrayControl,
} from "./SyncStatusTrayApp";

afterEach(cleanup);

const noop = () => {};

test("renders a green synced dot with the status as the button label", () => {
  const { getByRole, container } = render(
    <SyncStatusIndicatorView
      expanded={false}
      onToggle={noop}
      status="synced"
      title="All changes synced"
    />,
  );

  const button = getByRole("button");
  expect(button.getAttribute("aria-label")).toBe("All changes synced");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(
    container.querySelector(".sync-glyph--dot.sync-glyph--synced"),
  ).not.toBeNull();
  expect(container.querySelector("svg")).toBeNull();
});

test("renders a red dot for unflushed data", () => {
  const { container } = render(
    <SyncStatusIndicatorView
      expanded={false}
      onToggle={noop}
      status="pending"
      title="3 changes not yet synced"
    />,
  );

  expect(
    container.querySelector(".sync-glyph--dot.sync-glyph--pending"),
  ).not.toBeNull();
  expect(container.querySelector("svg")).toBeNull();
});

test("renders a warning glyph (not a dot) when billing blocks sync", () => {
  const { getByRole, container } = render(
    <SyncStatusIndicatorView
      expanded={false}
      onToggle={noop}
      status="billing"
      title="Free trial ended — sync paused. Update billing to resume."
    />,
  );

  const button = getByRole("button");
  expect(button.getAttribute("aria-label")).toContain("Free trial ended");
  expect(container.querySelector("svg.sync-glyph--billing")).not.toBeNull();
  expect(container.querySelector(".sync-glyph--dot")).toBeNull();
});

test("renders a danger warning glyph for terminal write failures", () => {
  const { getByRole, container } = render(
    <SyncStatusIndicatorView
      expanded={false}
      onToggle={noop}
      status="error"
      title="1 change failed to sync — Write access denied by the server (403)"
    />,
  );

  const button = getByRole("button");
  expect(button.getAttribute("aria-label")).toContain("failed to sync");
  expect(container.querySelector("svg.sync-glyph--error")).not.toBeNull();
  expect(container.querySelector(".sync-glyph--dot")).toBeNull();
});

test("reflects the expanded state and calls onToggle when clicked", () => {
  const onToggle = mock(() => {});
  const { getByRole } = render(
    <SyncStatusIndicatorView
      expanded={true}
      onToggle={onToggle}
      status="pending"
      title="1 change not yet synced"
    />,
  );

  const button = getByRole("button");
  expect(button.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(button);
  expect(onToggle).toHaveBeenCalledTimes(1);
});

function SyncedTrayControl() {
  return (
    <SyncStatusTrayControl
      billingBlocked={false}
      onOpenBilling={noop}
      onOpenWriteQueue={noop}
      showWriteQueueLink={false}
      status="synced"
      title="All changes synced"
    />
  );
}

const SYNC_ONLY_TRAY: SystemTrayDefinition<"sync-status"> = {
  apps: {
    "sync-status": { component: SyncedTrayControl, title: "Sync Status" },
  },
  order: ["sync-status"],
};

// LONG_PRESS_DELAY_MS in windowing's useLongPress is 450ms; wait past it.
const PAST_LONG_PRESS_MS = 550;

for (const gesture of ["right-click", "long press"] as const) {
  test(`a ${gesture} on the open popover's trigger shows only the tray's menu`, async () => {
    const { baseElement, getByRole } = render(
      <SystemTrayProvider
        definition={SYNC_ONLY_TRAY}
        storageKey="test.sync.tray"
      >
        <SystemTray />
      </SystemTrayProvider>,
    );
    const trigger = getByRole("button", { name: "All changes synced" });
    const menuLabels = () =>
      Array.from(baseElement.querySelectorAll(".menu"), (menu) =>
        menu.textContent?.trim(),
      );

    fireEvent.click(trigger);
    expect(menuLabels()).toEqual(["All changes synced"]);

    if (gesture === "right-click") {
      fireEvent.contextMenu(trigger, { clientX: 10, clientY: 10 });
    } else {
      fireEvent.pointerDown(trigger, {
        clientX: 10,
        clientY: 10,
        pointerType: "touch",
      });
      await act(async () => {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, PAST_LONG_PRESS_MS);
        await promise;
      });
    }
    expect(menuLabels()).toEqual(["Disable Sync Status"]);
  });
}

test("popover shows the status detail and no link when nothing is unflushed", () => {
  const { getByText, queryByRole } = render(
    <SyncStatusPopover
      billingBlocked={false}
      showWriteQueueLink={false}
      onOpenBilling={noop}
      onOpenWriteQueue={noop}
      title="All changes synced"
    />,
  );

  expect(getByText("All changes synced")).not.toBeNull();
  expect(queryByRole("button")).toBeNull();
});

test("popover links to the write queue when there is unflushed data", () => {
  const onOpenWriteQueue = mock(() => {});
  const { getByRole } = render(
    <SyncStatusPopover
      billingBlocked={false}
      showWriteQueueLink={true}
      onOpenBilling={noop}
      onOpenWriteQueue={onOpenWriteQueue}
      title="3 changes not yet synced"
    />,
  );

  const action = getByRole("button");
  expect(action.textContent).toContain("write queue");
  fireEvent.click(action);
  expect(onOpenWriteQueue).toHaveBeenCalledTimes(1);
});

test("popover links to billing when billing blocks sync", () => {
  const onOpenBilling = mock(() => {});
  const { getByRole } = render(
    <SyncStatusPopover
      billingBlocked={true}
      showWriteQueueLink={false}
      onOpenBilling={onOpenBilling}
      onOpenWriteQueue={noop}
      title="Subscription disabled — sync paused. Update billing to resume."
    />,
  );

  const action = getByRole("button");
  expect(action.textContent).toContain("Update billing");
  fireEvent.click(action);
  expect(onOpenBilling).toHaveBeenCalledTimes(1);
});

test("popover shows both links when billing is blocked and data is unflushed", () => {
  const onOpenBilling = mock(() => {});
  const onOpenWriteQueue = mock(() => {});
  const { getAllByRole } = render(
    <SyncStatusPopover
      billingBlocked={true}
      showWriteQueueLink={true}
      onOpenBilling={onOpenBilling}
      onOpenWriteQueue={onOpenWriteQueue}
      title="Free trial ended — sync paused. Update billing to resume."
    />,
  );

  const [billingAction, writeQueueAction] = getAllByRole("button");
  expect(billingAction?.textContent).toContain("Update billing");
  expect(writeQueueAction?.textContent).toContain("write queue");
  fireEvent.click(billingAction as HTMLElement);
  fireEvent.click(writeQueueAction as HTMLElement);
  expect(onOpenBilling).toHaveBeenCalledTimes(1);
  expect(onOpenWriteQueue).toHaveBeenCalledTimes(1);
});
