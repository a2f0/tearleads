import { expect, test } from "bun:test";
import {
  getMiniAppColumnResizeCommit,
  MINI_APP_COLUMN_MIN_WIDTH,
  MINI_APP_COLUMN_RESIZE_IDLE,
  type MiniAppColumnResizePair,
  type MiniAppColumnResizeState,
  resetMiniAppColumnWidths,
  resolveMiniAppColumnLayout,
  tradeMiniAppColumnWidths,
  transitionMiniAppColumnResize,
} from "./miniAppColumnResizeState";

const COLUMNS = [
  { id: "thumb", width: "4rem" },
  { id: "name", minWidth: "10rem", resizeLabel: "Name" },
  { id: "type", resizeLabel: "Type", width: "8rem" },
  { id: "modified", resizeLabel: "Modified", width: "11rem" },
  { id: "actions", width: "2.25rem" },
];

const PAIR: MiniAppColumnResizePair = {
  left: { fill: false, id: "type", width: 128 },
  right: { fill: false, id: "modified", width: 176 },
};

function press(
  pair: MiniAppColumnResizePair = PAIR,
  base = {},
): MiniAppColumnResizeState {
  return transitionMiniAppColumnResize(MINI_APP_COLUMN_RESIZE_IDLE, {
    base,
    clientX: 500,
    pair,
    pointerId: 7,
    type: "pressed",
  });
}

test("a table without chosen widths, or without a fill column, keeps its declared layout", () => {
  expect(resolveMiniAppColumnLayout(COLUMNS, undefined)).toEqual({
    boundaries: [null, null, null, null, null],
    colWidths: ["4rem", undefined, "8rem", "11rem", "2.25rem"],
    minWidth: undefined,
  });

  const measured = COLUMNS.map((column) => ({ ...column, width: "5rem" }));
  expect(resolveMiniAppColumnLayout(measured, { type: 200 })).toEqual({
    boundaries: [null, null, null, null, null],
    colWidths: ["5rem", "5rem", "5rem", "5rem", "5rem"],
    minWidth: undefined,
  });
});

test("chosen widths replace declared ones, and the fill column takes the rest", () => {
  const layout = resolveMiniAppColumnLayout(COLUMNS, {
    // Not resizable, and the fill column: neither takes a stored width.
    actions: 300,
    name: 300,
    type: 200,
  });

  expect(layout.colWidths).toEqual([
    "4rem",
    undefined,
    "200px",
    "11rem",
    "2.25rem",
  ]);
  expect(layout.minWidth).toBe("calc(4rem + 10rem + 200px + 11rem + 2.25rem)");
});

test("a fill column with no floor of its own gets the shared one", () => {
  const columns = COLUMNS.map(({ minWidth: _minWidth, ...column }) => column);
  expect(resolveMiniAppColumnLayout(columns, {}).minWidth).toBe(
    "calc(4rem + 3rem + 8rem + 11rem + 2.25rem)",
  );
});

test("only an edge between two labelled columns gets a boundary", () => {
  const { boundaries } = resolveMiniAppColumnLayout(COLUMNS, {});

  // thumb|name and modified|actions each have an unlabelled side.
  expect(boundaries).toEqual([
    null,
    null,
    {
      left: { fill: true, id: "name", label: "Name" },
      right: { fill: false, id: "type", label: "Type" },
    },
    {
      left: { fill: false, id: "type", label: "Type" },
      right: { fill: false, id: "modified", label: "Modified" },
    },
    null,
  ]);
});

test("a trade moves width from one neighbour to the other", () => {
  expect(tradeMiniAppColumnWidths(PAIR, 40)).toEqual({
    modified: 136,
    type: 168,
  });
  expect(tradeMiniAppColumnWidths(PAIR, -40)).toEqual({
    modified: 216,
    type: 88,
  });
});

test("a trade stops at each neighbour's minimum", () => {
  expect(tradeMiniAppColumnWidths(PAIR, 10_000)).toEqual({
    modified: MINI_APP_COLUMN_MIN_WIDTH,
    type: 304 - MINI_APP_COLUMN_MIN_WIDTH,
  });
  expect(tradeMiniAppColumnWidths(PAIR, Number.NEGATIVE_INFINITY)).toEqual({
    modified: 304 - MINI_APP_COLUMN_MIN_WIDTH,
    type: MINI_APP_COLUMN_MIN_WIDTH,
  });
});

test("a trade keeps the pair's total when the measured widths are fractional", () => {
  const traded = tradeMiniAppColumnWidths(
    {
      left: { fill: false, id: "type", width: 128.4 },
      right: { fill: false, id: "modified", width: 175.9 },
    },
    10.3,
  );

  expect(traded).toEqual({ modified: 165, type: 139 });
});

test("a fill neighbour stores nothing: it takes what the other leaves", () => {
  expect(
    tradeMiniAppColumnWidths(
      {
        left: { fill: true, id: "name", width: 400 },
        right: { fill: false, id: "type", width: 128 },
      },
      -30,
    ),
  ).toEqual({ type: 158 });
});

test("a pair too narrow for two minimums does not trade", () => {
  expect(
    tradeMiniAppColumnWidths(
      {
        left: { fill: false, id: "type", width: 50 },
        right: { fill: false, id: "modified", width: 40 },
      },
      10,
    ),
  ).toEqual({});
  // Unmeasured, as in an environment without layout.
  expect(
    tradeMiniAppColumnWidths(
      {
        left: { fill: false, id: "type", width: 0 },
        right: { fill: false, id: "modified", width: 0 },
      },
      10,
    ),
  ).toEqual({});
});

test("resetting a boundary drops both neighbours' chosen widths only", () => {
  expect(
    resetMiniAppColumnWidths(
      { modified: 200, size: 90, type: 150 },
      {
        left: { fill: false, id: "type", label: "Type" },
        right: { fill: false, id: "modified", label: "Modified" },
      },
    ),
  ).toEqual({ size: 90 });
});

test("a drag draws each move over the widths it started from and stores the last", () => {
  const pressed = press(PAIR, { size: 90 });
  expect(pressed).toMatchObject({ status: "dragging", widths: { size: 90 } });

  const moved = transitionMiniAppColumnResize(pressed, {
    clientX: 540,
    pointerId: 7,
    type: "moved",
  });
  expect(moved).toMatchObject({
    status: "dragging",
    widths: { modified: 136, size: 90, type: 168 },
  });

  // Each move is measured from the press, not from the move before it.
  const movedBack = transitionMiniAppColumnResize(moved, {
    clientX: 480,
    pointerId: 7,
    type: "moved",
  });
  expect(movedBack).toMatchObject({
    widths: { modified: 196, size: 90, type: 108 },
  });

  const released = { pointerId: 7, type: "released" } as const;
  expect(getMiniAppColumnResizeCommit(movedBack, released)).toEqual({
    modified: 196,
    size: 90,
    type: 108,
  });
  expect(transitionMiniAppColumnResize(movedBack, released)).toEqual(
    MINI_APP_COLUMN_RESIZE_IDLE,
  );
});

test("a press that never moves stores nothing", () => {
  const pressed = press();
  expect(
    getMiniAppColumnResizeCommit(pressed, { pointerId: 7, type: "released" }),
  ).toBeNull();
});

test("a cancelled drag ends without storing what it had drawn", () => {
  const moved = transitionMiniAppColumnResize(press(), {
    clientX: 540,
    pointerId: 7,
    type: "moved",
  });
  const cancelled = { pointerId: 7, type: "cancelled" } as const;

  expect(getMiniAppColumnResizeCommit(moved, cancelled)).toBeNull();
  expect(transitionMiniAppColumnResize(moved, cancelled)).toEqual(
    MINI_APP_COLUMN_RESIZE_IDLE,
  );
});

test("another pointer can neither move, end, nor take over a drag", () => {
  const pressed = press();

  for (const event of [
    { clientX: 900, pointerId: 8, type: "moved" },
    { pointerId: 8, type: "released" },
    { pointerId: 8, type: "cancelled" },
  ] as const) {
    expect(transitionMiniAppColumnResize(pressed, event)).toBe(pressed);
    expect(getMiniAppColumnResizeCommit(pressed, event)).toBeNull();
  }
  expect(
    transitionMiniAppColumnResize(pressed, {
      base: {},
      clientX: 0,
      pair: PAIR,
      pointerId: 8,
      type: "pressed",
    }),
  ).toBe(pressed);
});

test("moves and releases with no drag in progress change nothing", () => {
  for (const event of [
    { clientX: 900, pointerId: 7, type: "moved" },
    { pointerId: 7, type: "released" },
    { pointerId: 7, type: "cancelled" },
  ] as const) {
    expect(
      transitionMiniAppColumnResize(MINI_APP_COLUMN_RESIZE_IDLE, event),
    ).toBe(MINI_APP_COLUMN_RESIZE_IDLE);
    expect(
      getMiniAppColumnResizeCommit(MINI_APP_COLUMN_RESIZE_IDLE, event),
    ).toBeNull();
  }
});
