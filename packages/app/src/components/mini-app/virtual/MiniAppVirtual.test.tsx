import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  getMiniAppVirtualWindowRange,
  MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT,
  MiniAppVirtualList,
  MiniAppVirtualListFrame,
  MiniAppVirtualListRow,
  useMiniAppVirtualRows,
  useMiniAppVirtualWindow,
} from "./MiniAppVirtual";

afterEach(() => {
  cleanup();
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

test("a row-pitch change keeps the same row at the top of the viewport", () => {
  // The pitch is dynamic now (a pane narrow enough to fold its rows uses a
  // taller one), and scrollTop is pixels while the window range is rows. Without
  // rescaling, the same pixel offset resolves to a different row and the list
  // silently jumps.
  const offsets: number[] = [];

  function Probe({ rowHeight }: { rowHeight: number }) {
    const { frameRef, offset } = useMiniAppVirtualWindow({ rowHeight });
    offsets.push(offset);
    return <div data-testid="frame" ref={frameRef} />;
  }

  const view = render(<Probe rowHeight={36} />);
  const frame = view.getByTestId("frame");
  // Row 100 sits at the top: 100 * 36px.
  frame.scrollTop = 3600;
  fireEvent.scroll(frame);
  const settledOffset = offsets.at(-1);
  expect(settledOffset).toBe(92);

  const rendersBeforePitchChange = offsets.length;
  view.rerender(<Probe rowHeight={56} />);

  // The pixel offset is rescaled to 100 * 56px, so the row at the top is the
  // same one.
  expect(frame.scrollTop).toBe(5600);
  // And no render in between ever exposed a different window: a consumer that
  // fetches from the offset (the explorer item list) would have issued a query
  // for a transient offset and blanked itself before the correction landed.
  expect(offsets.slice(rendersBeforePitchChange)).not.toContain(0);
  expect(
    offsets.slice(rendersBeforePitchChange).every((o) => o === settledOffset),
  ).toBe(true);
});
