import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  getMiniAppVirtualWindowRange,
  MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT,
  MiniAppVirtualList,
  MiniAppVirtualListFrame,
  MiniAppVirtualListRow,
  useMiniAppVirtualRows,
} from "./MiniAppVirtual";

const resizeObserverGlobal = globalThis as unknown as {
  ResizeObserver?: unknown;
};
const originalResizeObserver = resizeObserverGlobal.ResizeObserver;

afterEach(() => {
  cleanup();
  resizeObserverGlobal.ResizeObserver = originalResizeObserver;
});

test("mini app virtual range clamps invalid scroll values and uses minimum window", () => {
  expect(
    getMiniAppVirtualWindowRange({
      rowHeight: 36,
      scrollTop: Number.NaN,
      viewportHeight: -1,
    }),
  ).toEqual({ limit: 24, offset: 0 });
});

test("mini app virtual range derives offset and limit from row height and overscan", () => {
  expect(
    getMiniAppVirtualWindowRange({
      rowHeight: 36,
      scrollTop: 720,
      viewportHeight: 360,
    }),
  ).toEqual({ limit: 26, offset: 12 });
});

function VirtualListHarness({ rows }: { rows: ReadonlyArray<string> }) {
  const virtualRows = useMiniAppVirtualRows({
    rowHeight: MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT,
    rows,
  });

  return (
    <MiniAppVirtualListFrame
      data-testid="virtual-frame"
      ref={virtualRows.frameRef}
      rowHeight={MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT}
    >
      <MiniAppVirtualList
        bottomPadding={virtualRows.bottomPadding}
        topPadding={virtualRows.topPadding}
      >
        {virtualRows.rows.map((row) => (
          <MiniAppVirtualListRow key={row}>{row}</MiniAppVirtualListRow>
        ))}
      </MiniAppVirtualList>
    </MiniAppVirtualListFrame>
  );
}

test("mini app virtual rows render a scroll-driven slice", async () => {
  resizeObserverGlobal.ResizeObserver = undefined;
  const rows = Array.from({ length: 80 }, (_, index) => `row-${index + 1}`);
  const view = render(<VirtualListHarness rows={rows} />);
  const frame = view.getByTestId("virtual-frame");

  expect(view.getByText("row-1")).toBeTruthy();
  expect(view.queryByText("row-80")).toBeNull();

  frame.scrollTop = 840;
  fireEvent.scroll(frame);

  await waitFor(() => {
    expect(view.getByText("row-23")).toBeTruthy();
  });
  expect(view.queryByText("row-1")).toBeNull();
});
