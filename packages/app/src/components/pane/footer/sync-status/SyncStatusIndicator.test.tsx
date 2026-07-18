import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  SyncStatusIndicatorView,
  SyncStatusPopover,
} from "./SyncStatusIndicator";

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
  expect(button.className).toContain("sync-status-indicator--synced");
  expect(container.querySelector(".sync-status-indicator-dot")).not.toBeNull();
  expect(container.querySelector("svg")).toBeNull();
});

test("renders a red dot for unflushed data", () => {
  const { getByRole, container } = render(
    <SyncStatusIndicatorView
      expanded={false}
      onToggle={noop}
      status="pending"
      title="3 changes not yet synced"
    />,
  );

  expect(getByRole("button").className).toContain(
    "sync-status-indicator--pending",
  );
  expect(container.querySelector(".sync-status-indicator-dot")).not.toBeNull();
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
  expect(button.className).toContain("sync-status-indicator--billing");
  expect(button.getAttribute("aria-label")).toContain("Free trial ended");
  expect(container.querySelector("svg")).not.toBeNull();
  expect(container.querySelector(".sync-status-indicator-dot")).toBeNull();
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

test("popover shows the status detail and no link when nothing is unflushed", () => {
  const { getByText, queryByRole } = render(
    <SyncStatusPopover
      hasUnflushed={false}
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
      hasUnflushed={true}
      onOpenWriteQueue={onOpenWriteQueue}
      title="3 changes not yet synced"
    />,
  );

  const action = getByRole("button");
  expect(action.textContent).toContain("write queue");
  fireEvent.click(action);
  expect(onOpenWriteQueue).toHaveBeenCalledTimes(1);
});
