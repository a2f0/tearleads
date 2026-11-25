import { expect, test } from "bun:test";
import {
  getMiniAppColumnResizeCommit,
  isMiniAppColumnResetDue,
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
  left: { fill: false, id: "type", min: 48, width: 128 },
  right: { fill: false, id: "modified", min: 48, width: 176 },
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
      left: { fill: false, id: "type", min: 48, width: 128.4 },
      right: { fill: false, id: "modified", min: 48, width: 175.9 },
    },
    10.3,
  );

  expect(traded).toEqual({ modified: 165, type: 139 });
});

test("a fill neighbour stores nothing: it takes what the other leaves", () => {
  expect(
    tradeMiniAppColumnWidths(
      {
        left: { fill: true, id: "name", min: 48, width: 400 },
        right: { fill: false, id: "type", min: 48, width: 128 },
      },
      -30,
    ),
  ).toEqual({ type: 158 });
});

test("a fill neighbour stops at the floor the table holds it to", () => {
  const pair: MiniAppColumnResizePair = {
    // The table has 40px to give up before it would outgrow its frame.
    left: { fill: true, id: "name", min: 160, width: 200 },
    right: { fill: false, id: "type", min: 48, width: 128 },
  };

  expect(tradeMiniAppColumnWidths(pair, -30)).toEqual({ type: 158 });
  expect(tradeMiniAppColumnWidths(pair, -300)).toEqual({ type: 168 });

  // On the other side of the edge, it caps how far the left column grows.
  expect(
    tradeMiniAppColumnWidths(
      {
        left: { fill: false, id: "type", min: 48, width: 128 },
        right: { fill: true, id: "name", min: 160, width: 200 },
      },
      300,
    ),
  ).toEqual({ type: 168 });
});

test("a pair too narrow for two minimums does not trade", () => {
  expect(
    tradeMiniAppColumnWidths(
      {
        left: { fill: false, id: "type", min: 48, width: 50 },
        right: { fill: false, id: "modified", min: 48, width: 40 },
      },
      10,
    ),
  ).toEqual({});
  // Unmeasured, as in an environment without layout.
  expect(
    tradeMiniAppColumnWidths(
      {
        left: { fill: false, id: "type", min: 48, width: 0 },
        right: { fill: false, id: "modified", min: 48, width: 0 },
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

test("a pointer within the drag threshold of its press draws and stores nothing", () => {
  const pressed = press(PAIR, { size: 90 });
  const released = { pointerId: 7, type: "released" } as const;

  for (const clientX of [500, 498, 502]) {
    const jittered = transitionMiniAppColumnResize(pressed, {
      clientX,
      pointerId: 7,
      type: "moved",
    });
    expect(jittered).toMatchObject({
      status: "dragging",
      widths: { size: 90 },
    });
    expect(getMiniAppColumnResizeCommit(jittered, released)).toBeNull();
  }

  // Past the threshold it is a drag, measured from the press; back inside it,
  // the columns return to where they started and nothing is stored.
  const dragged = transitionMiniAppColumnResize(pressed, {
    clientX: 503,
    pointerId: 7,
    type: "moved",
  });
  expect(dragged).toMatchObject({
    widths: { modified: 173, size: 90, type: 131 },
  });
  const returned = transitionMiniAppColumnResize(dragged, {
    clientX: 501,
    pointerId: 7,
    type: "moved",
  });
  expect(getMiniAppColumnResizeCommit(returned, released)).toBeNull();
});

function stillPress(
  state: MiniAppColumnResizeState,
  pointerId: number,
): MiniAppColumnResizeState {
  const pressed = transitionMiniAppColumnResize(state, {
    base: {},
    clientX: 500,
    pair: PAIR,
    pointerId,
    type: "pressed",
  });
  return transitionMiniAppColumnResize(pressed, {
    pointerId,
    type: "released",
  });
}

test("a reset is due after two presses in a row that dragged nothing", () => {
  const once = stillPress(MINI_APP_COLUMN_RESIZE_IDLE, 1);
  expect(isMiniAppColumnResetDue(MINI_APP_COLUMN_RESIZE_IDLE)).toBe(false);
  expect(isMiniAppColumnResetDue(once)).toBe(false);
  // Not due: the double-click is ignored and the count stands.
  expect(transitionMiniAppColumnResize(once, { type: "reset" })).toBe(once);

  const twice = stillPress(once, 2);
  expect(isMiniAppColumnResetDue(twice)).toBe(true);
  expect(transitionMiniAppColumnResize(twice, { type: "reset" })).toEqual(
    MINI_APP_COLUMN_RESIZE_IDLE,
  );
});

test("a drag or a cancelled press starts the count of still presses again", () => {
  const once = stillPress(MINI_APP_COLUMN_RESIZE_IDLE, 1);

  const pressed = transitionMiniAppColumnResize(once, {
    base: {},
    clientX: 500,
    pair: PAIR,
    pointerId: 2,
    type: "pressed",
  });
  // A press in progress is never a reset, whatever came before it.
  expect(isMiniAppColumnResetDue(pressed)).toBe(false);
  expect(transitionMiniAppColumnResize(pressed, { type: "reset" })).toBe(
    pressed,
  );

  const dragged = transitionMiniAppColumnResize(
    transitionMiniAppColumnResize(pressed, {
      clientX: 540,
      pointerId: 2,
      type: "moved",
    }),
    { pointerId: 2, type: "released" },
  );
  expect(dragged).toEqual(MINI_APP_COLUMN_RESIZE_IDLE);
  expect(isMiniAppColumnResetDue(stillPress(dragged, 3))).toBe(false);

  const cancelled = transitionMiniAppColumnResize(pressed, {
    pointerId: 2,
    type: "cancelled",
  });
  expect(cancelled).toEqual(MINI_APP_COLUMN_RESIZE_IDLE);
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
