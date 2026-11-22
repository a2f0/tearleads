import { afterEach, expect, mock, test } from "bun:test";
import {
  SystemTray,
  type SystemTrayDefinition,
  SystemTrayProvider,
} from "@tearleads/windowing";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { SyncStatusPopover } from "./SyncStatusPopover";
import {
  SyncStatusIndicatorView,
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

test("renders a syncing ring, not an alarm, while content is still arriving", () => {
  const { container } = render(
    <SyncStatusIndicatorView
      expanded={false}
      onToggle={noop}
      status="syncing"
      title="All changes synced, syncing updates…"
    />,
  );

  expect(
    container.querySelector(".sync-glyph--dot.sync-glyph--syncing"),
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
      renderPopover={() => (
        <SyncStatusPopover
          actions={[]}
          details={[]}
          title="All changes synced"
        />
      )}
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

test("popover shows the status and its details, and no action when none applies", () => {
  const { getByText, queryByRole } = render(
    <SyncStatusPopover
      actions={[]}
      details={["Changes to upload: none", "Downloads: none waiting"]}
      title="All changes synced"
    />,
  );

  expect(getByText("All changes synced")).not.toBeNull();
  expect(getByText("Changes to upload: none")).not.toBeNull();
  expect(getByText("Downloads: none waiting")).not.toBeNull();
  expect(queryByRole("button")).toBeNull();
});

test("popover lists its actions in order and runs the one chosen", () => {
  const syncNow = mock(() => {});
  const openDownloads = mock(() => {});
  const { getAllByRole } = render(
    <SyncStatusPopover
      actions={[
        { id: "sync-now", label: "Sync now", onSelect: syncNow },
        { id: "downloads", label: "View downloads", onSelect: openDownloads },
      ]}
      details={["Downloading 42 items"]}
      title="All changes synced, syncing updates…"
    />,
  );

  const [syncAction, downloadsAction] = getAllByRole("button");
  expect(syncAction?.textContent).toBe("Sync now");
  expect(downloadsAction?.textContent).toBe("View downloads");
  fireEvent.click(downloadsAction as HTMLElement);
  expect(openDownloads).toHaveBeenCalledTimes(1);
  expect(syncNow).not.toHaveBeenCalled();
});
