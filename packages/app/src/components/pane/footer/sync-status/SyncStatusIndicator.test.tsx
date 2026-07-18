import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { SyncStatusIndicatorView } from "./SyncStatusIndicator";

afterEach(cleanup);

test("renders a green synced dot with the status as its accessible label", () => {
  const { getByRole, container } = render(
    <SyncStatusIndicatorView status="synced" title="All changes synced" />,
  );

  const indicator = getByRole("img");
  expect(indicator.getAttribute("aria-label")).toBe("All changes synced");
  expect(indicator.className).toContain("sync-status-indicator--synced");
  expect(container.querySelector(".sync-status-indicator-dot")).not.toBeNull();
  expect(container.querySelector("svg")).toBeNull();
});

test("renders a red dot for unflushed data", () => {
  const { getByRole, container } = render(
    <SyncStatusIndicatorView
      status="pending"
      title="3 changes not yet synced"
    />,
  );

  expect(getByRole("img").className).toContain(
    "sync-status-indicator--pending",
  );
  expect(container.querySelector(".sync-status-indicator-dot")).not.toBeNull();
  expect(container.querySelector("svg")).toBeNull();
});

test("renders a warning glyph (not a dot) when billing blocks sync", () => {
  const { getByRole, container } = render(
    <SyncStatusIndicatorView
      status="billing"
      title="Free trial ended — sync paused. Update billing to resume."
    />,
  );

  const indicator = getByRole("img");
  expect(indicator.className).toContain("sync-status-indicator--billing");
  expect(indicator.getAttribute("aria-label")).toContain("Free trial ended");
  expect(container.querySelector("svg")).not.toBeNull();
  expect(container.querySelector(".sync-status-indicator-dot")).toBeNull();
});

test("renders a muted dot while the first read is still loading", () => {
  const { getByRole, container } = render(
    <SyncStatusIndicatorView status="loading" title="Checking sync status…" />,
  );

  expect(getByRole("img").className).toContain(
    "sync-status-indicator--loading",
  );
  expect(container.querySelector(".sync-status-indicator-dot")).not.toBeNull();
});
