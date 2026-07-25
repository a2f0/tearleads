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

test("popover shows the status detail and no link when nothing is unflushed", () => {
  const { getByText, queryByRole } = render(
    <SyncStatusPopover
      billingBlocked={false}
      hasUnflushed={false}
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
      hasUnflushed={true}
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
      hasUnflushed={false}
      onOpenBilling={onOpenBilling}
      onOpenWriteQueue={noop}
      title="Payment past due — sync paused. Update billing to resume."
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
      hasUnflushed={true}
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
