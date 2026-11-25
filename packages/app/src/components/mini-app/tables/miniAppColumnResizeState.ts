/**
 * Column resizing for a list table: which columns can trade width, how a drag
 * moves the boundary between two of them, and the drag's own states. Pure, so
 * the table (MiniAppColumnResize.tsx) only measures, dispatches, and renders.
 *
 * A boundary trades width between its two neighbours: the left one grows by
 * what the right one gives up. Nothing else in the table moves, so the boundary
 * stays under the pointer wherever the table's fill column sits, and a drag
 * never pushes the table wider than its frame.
 */

/**
 * Chosen column widths in CSS pixels, by column id. A column without an entry
 * keeps the width it declares.
 */
export type MiniAppColumnWidths = Readonly<Record<string, number>>;

/** The narrowest a drag or an arrow key may leave either neighbour. */
export const MINI_APP_COLUMN_MIN_WIDTH = 48;

/** What a fill column shrinks to before the table scrolls sideways instead. */
const MINI_APP_FILL_COLUMN_MIN_WIDTH = "3rem";

/** The fields of a table column that resizing reads. */
interface MiniAppResizableColumn {
  readonly id: string;
  readonly minWidth?: string | undefined;
  readonly resizeLabel?: string | undefined;
  readonly width?: string | undefined;
}

interface MiniAppColumnBoundarySide {
  /** A fill column takes the table's slack, so no width is stored for it. */
  readonly fill: boolean;
  readonly id: string;
  readonly label: string;
}

/** The edge two resizable columns share, which a handle moves. */
export interface MiniAppColumnBoundary {
  readonly left: MiniAppColumnBoundarySide;
  readonly right: MiniAppColumnBoundarySide;
}

export interface MiniAppColumnLayout {
  /**
   * By column index: the boundary on that column's leading edge, or null when
   * it and the column before it cannot trade width.
   */
  readonly boundaries: ReadonlyArray<MiniAppColumnBoundary | null>;
  /** By column index: the CSS width of its `<col>`. */
  readonly colWidths: ReadonlyArray<string | undefined>;
  /** The table's own floor, or undefined to leave the caller's in place. */
  readonly minWidth: string | undefined;
}

function isFillColumn(column: MiniAppResizableColumn): boolean {
  return column.width === undefined;
}

function toBoundarySide(
  column: MiniAppResizableColumn | undefined,
): MiniAppColumnBoundarySide | null {
  return column?.resizeLabel === undefined
    ? null
    : { fill: isFillColumn(column), id: column.id, label: column.resizeLabel };
}

/**
 * Resolves the widths a table lays its columns out with.
 *
 * Resizing needs a fill column, one that declares no width, to take up what
 * the others leave: without it a fixed table layout spreads spare room over
 * every column, and a chosen width would not be the width drawn. A table with
 * no fill column, like one handed no `widths`, keeps its declared layout and
 * gets no boundaries.
 */
export function resolveMiniAppColumnLayout(
  columns: ReadonlyArray<MiniAppResizableColumn>,
  widths: MiniAppColumnWidths | undefined,
): MiniAppColumnLayout {
  if (widths === undefined || !columns.some(isFillColumn)) {
    return {
      boundaries: columns.map(() => null),
      colWidths: columns.map((column) => column.width),
      minWidth: undefined,
    };
  }

  const colWidths = columns.map((column) => {
    const chosen = widths[column.id];
    return column.resizeLabel !== undefined &&
      chosen !== undefined &&
      !isFillColumn(column)
      ? `${chosen}px`
      : column.width;
  });

  return {
    boundaries: columns.map((column, index) => {
      const left = toBoundarySide(columns[index - 1]);
      const right = toBoundarySide(column);
      return left && right ? { left, right } : null;
    }),
    colWidths,
    // Holds every measured column at its width and each fill column at its
    // floor; a frame narrower than this scrolls the table sideways.
    minWidth: `calc(${columns
      .map(
        (column, index) =>
          colWidths[index] ?? column.minWidth ?? MINI_APP_FILL_COLUMN_MIN_WIDTH,
      )
      .join(" + ")})`,
  };
}

interface MiniAppColumnResizeSide {
  readonly fill: boolean;
  readonly id: string;
  /** The column's rendered width when the trade began. */
  readonly width: number;
}

export interface MiniAppColumnResizePair {
  readonly left: MiniAppColumnResizeSide;
  readonly right: MiniAppColumnResizeSide;
}

/**
 * The widths to store after moving a pair's boundary `delta` pixels to the
 * right (negative for left). Both neighbours stay at or above the minimum, and
 * a fill neighbour gets no entry: it takes whatever the other one leaves.
 * A pair too narrow to give either side the minimum does not trade.
 */
export function tradeMiniAppColumnWidths(
  pair: MiniAppColumnResizePair,
  delta: number,
): MiniAppColumnWidths {
  const total = Math.round(pair.left.width + pair.right.width);
  const maxLeft = total - MINI_APP_COLUMN_MIN_WIDTH;
  if (maxLeft < MINI_APP_COLUMN_MIN_WIDTH) {
    return {};
  }

  const left = Math.round(
    Math.min(
      maxLeft,
      Math.max(MINI_APP_COLUMN_MIN_WIDTH, pair.left.width + delta),
    ),
  );
  return {
    ...(pair.left.fill ? {} : { [pair.left.id]: left }),
    ...(pair.right.fill ? {} : { [pair.right.id]: total - left }),
  };
}

/** Drops the pair's chosen widths, so both return to what they declare. */
export function resetMiniAppColumnWidths(
  widths: MiniAppColumnWidths,
  boundary: MiniAppColumnBoundary,
): MiniAppColumnWidths {
  return Object.fromEntries(
    Object.entries(widths).filter(
      ([id]) => id !== boundary.left.id && id !== boundary.right.id,
    ),
  );
}

export type MiniAppColumnResizeState =
  | { readonly status: "idle" }
  | {
      readonly status: "dragging";
      /** The stored widths the drag started from. */
      readonly base: MiniAppColumnWidths;
      readonly pair: MiniAppColumnResizePair;
      readonly pointerId: number;
      readonly startX: number;
      /**
       * What the table draws while the drag lasts, and what a release stores.
       * Still `base` itself until the pointer moves, so a press that never
       * moves stores nothing.
       */
      readonly widths: MiniAppColumnWidths;
    };

export type MiniAppColumnResizeEvent =
  | {
      readonly type: "pressed";
      readonly base: MiniAppColumnWidths;
      readonly clientX: number;
      readonly pair: MiniAppColumnResizePair;
      readonly pointerId: number;
    }
  | {
      readonly type: "moved";
      readonly clientX: number;
      readonly pointerId: number;
    }
  /** `released` and `cancelled` both end the drag; only a release is stored. */
  | { readonly type: "released"; readonly pointerId: number }
  | { readonly type: "cancelled"; readonly pointerId: number };

export const MINI_APP_COLUMN_RESIZE_IDLE: MiniAppColumnResizeState = {
  status: "idle",
};

export function transitionMiniAppColumnResize(
  state: MiniAppColumnResizeState,
  event: MiniAppColumnResizeEvent,
): MiniAppColumnResizeState {
  if (event.type === "pressed") {
    // A second pointer cannot take over a drag in progress.
    return state.status === "idle"
      ? {
          base: event.base,
          pair: event.pair,
          pointerId: event.pointerId,
          startX: event.clientX,
          status: "dragging",
          widths: event.base,
        }
      : state;
  }

  if (state.status !== "dragging" || state.pointerId !== event.pointerId) {
    return state;
  }

  if (event.type === "moved") {
    return {
      ...state,
      widths: {
        ...state.base,
        ...tradeMiniAppColumnWidths(state.pair, event.clientX - state.startX),
      },
    };
  }

  return MINI_APP_COLUMN_RESIZE_IDLE;
}

/**
 * The widths to store when `event` ends a drag in `state`, or null when it
 * stores nothing: the event is not this drag's release, or the pointer never
 * moved.
 */
export function getMiniAppColumnResizeCommit(
  state: MiniAppColumnResizeState,
  event: MiniAppColumnResizeEvent,
): MiniAppColumnWidths | null {
  return state.status === "dragging" &&
    event.type === "released" &&
    event.pointerId === state.pointerId &&
    state.widths !== state.base
    ? state.widths
    : null;
}
