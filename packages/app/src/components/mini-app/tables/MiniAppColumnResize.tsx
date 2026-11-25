import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { classNames } from "../../shared/classNames";
import type { MiniAppColumnWidthsControl } from "./MiniAppColumnWidths";
import {
  getMiniAppColumnResizeCommit,
  isMiniAppColumnResetDue,
  MINI_APP_COLUMN_MIN_WIDTH,
  MINI_APP_COLUMN_RESIZE_IDLE,
  type MiniAppColumnBoundary,
  type MiniAppColumnLayout,
  type MiniAppColumnResizeEvent,
  type MiniAppColumnResizePair,
  resetMiniAppColumnWidths,
  resolveMiniAppColumnLayout,
  tradeMiniAppColumnWidths,
  transitionMiniAppColumnResize,
} from "./miniAppColumnResizeState";
import "./MiniAppColumnResize.css";

const KEYBOARD_RESIZE_STEP = 10;
const KEYBOARD_RESIZE_SHIFT_MULTIPLIER = 5;

/** The header cells a handle sits between: its own, and the one before it. */
function getMiniAppColumnPairCells(handle: Element) {
  const right = handle.closest("th");
  const left = right?.previousElementSibling;
  const table = right?.closest("table");
  return right && left && table ? { left, right, table } : null;
}

/**
 * Reads the two columns a handle sits between from the header cells drawn.
 *
 * A fill column has no width of its own to stop at: the table's `min-width`
 * holds it at its floor, and past that the table would grow instead and scroll
 * its frame sideways. So its floor here is what it would be left with once the
 * table has given up all the room it has beyond that `min-width`.
 */
function measureMiniAppColumnPair(
  handle: Element,
  boundary: {
    left: Pick<MiniAppColumnBoundary["left"], "fill" | "id">;
    right: Pick<MiniAppColumnBoundary["right"], "fill" | "id">;
  },
): MiniAppColumnResizePair | null {
  const cells = getMiniAppColumnPairCells(handle);
  if (!cells) {
    return null;
  }

  const tableFloor = Number.parseFloat(getComputedStyle(cells.table).minWidth);
  // Unresolved where there is no layout; the shared minimum then stands in.
  const slack = Number.isFinite(tableFloor)
    ? Math.max(0, cells.table.getBoundingClientRect().width - tableFloor)
    : Number.POSITIVE_INFINITY;
  const measureSide = (
    side: Pick<MiniAppColumnBoundary["left"], "fill" | "id">,
    cell: Element,
  ): MiniAppColumnResizePair["left"] => {
    const width = cell.getBoundingClientRect().width;
    return {
      fill: side.fill,
      id: side.id,
      min: side.fill
        ? Math.max(MINI_APP_COLUMN_MIN_WIDTH, width - slack)
        : MINI_APP_COLUMN_MIN_WIDTH,
      width,
    };
  };

  return {
    left: measureSide(boundary.left, cells.left),
    right: measureSide(boundary.right, cells.right),
  };
}

function getKeyboardResizeDelta(
  event: KeyboardEvent<HTMLHRElement>,
): number | null {
  const step =
    KEYBOARD_RESIZE_STEP *
    (event.shiftKey ? KEYBOARD_RESIZE_SHIFT_MULTIPLIER : 1);
  switch (event.key) {
    case "ArrowLeft":
      return -step;
    case "ArrowRight":
      return step;
    // As far as the pair allows: the trade clamps to each side's minimum.
    case "Home":
      return Number.NEGATIVE_INFINITY;
    case "End":
      return Number.POSITIVE_INFINITY;
    default:
      return null;
  }
}

/** A drag's later events: everything but the press that starts it. */
type MiniAppColumnDragEvent = Exclude<
  MiniAppColumnResizeEvent,
  { type: "pressed" }
>;

interface MiniAppColumnResizeHandleProps {
  boundary: MiniAppColumnBoundary;
  /** The left-hand column's chosen width, when it has one. */
  chosenLeft: number | undefined;
  dragging: boolean;
  onAbandon: () => void;
  onDrag: (event: MiniAppColumnDragEvent) => void;
  onNudge: (pair: MiniAppColumnResizePair, delta: number) => void;
  onPress: (press: {
    clientX: number;
    pair: MiniAppColumnResizePair;
    pointerId: number;
  }) => void;
  onReset: () => void;
}

/**
 * A separator announces its position and range, which only layout knows: read
 * them once the handle is drawn, then whenever either column changes size (a
 * chosen width, a resized frame, a column switched on or off beside the fill
 * one), and on demand through `measure`.
 */
function useMiniAppColumnPairMeasure(
  handleRef: RefObject<HTMLHRElement | null>,
  boundary: MiniAppColumnBoundary,
) {
  const [measured, setMeasured] = useState({ max: 0, min: 0, now: 0 });
  const leftFill = boundary.left.fill;
  const leftId = boundary.left.id;
  const rightFill = boundary.right.fill;
  const rightId = boundary.right.id;

  const measure = useCallback(() => {
    const handle = handleRef.current;
    const pair = handle
      ? measureMiniAppColumnPair(handle, {
          left: { fill: leftFill, id: leftId },
          right: { fill: rightFill, id: rightId },
        })
      : null;
    if (!pair) {
      return;
    }

    const next = {
      max: Math.round(pair.left.width + pair.right.width - pair.right.min),
      min: Math.round(pair.left.min),
      now: Math.round(pair.left.width),
    };
    setMeasured((current) =>
      current.max === next.max &&
      current.min === next.min &&
      current.now === next.now
        ? current
        : next,
    );
  }, [handleRef, leftFill, leftId, rightFill, rightId]);

  useLayoutEffect(() => {
    const handle = handleRef.current;
    const cells = handle ? getMiniAppColumnPairCells(handle) : null;
    if (!cells) {
      return;
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(cells.left);
    observer.observe(cells.right);
    return () => observer.disconnect();
  }, [handleRef, measure]);

  return { measure, measured };
}

/**
 * The handle on the edge two columns share. It is a focusable separator, as the
 * sidebar's is: drag it, or use the arrow keys (Shift for larger steps, Home
 * and End for the limits), and double-click it to give both columns back the
 * widths they declare.
 */
function MiniAppColumnResizeHandle({
  boundary,
  chosenLeft,
  dragging,
  onAbandon,
  onDrag,
  onNudge,
  onPress,
  onReset,
}: MiniAppColumnResizeHandleProps) {
  const handleRef = useRef<HTMLHRElement>(null);
  const { measure, measured } = useMiniAppColumnPairMeasure(
    handleRef,
    boundary,
  );

  // A handle that leaves mid-drag (the table folded, or lost its columns) can
  // no longer deliver the release, so it ends the drag without storing it.
  useEffect(() => (dragging ? onAbandon : undefined), [dragging, onAbandon]);

  return (
    <hr
      aria-label={`Resize ${boundary.left.label} and ${boundary.right.label} columns`}
      aria-orientation="vertical"
      aria-valuemax={measured.max}
      aria-valuemin={measured.min}
      aria-valuenow={chosenLeft ?? measured.now}
      className={classNames(
        "mini-app-column-resize-handle",
        dragging && "mini-app-column-resize-handle--dragging",
      )}
      onDoubleClick={onReset}
      onFocus={measure}
      onKeyDown={(event: KeyboardEvent<HTMLHRElement>) => {
        const delta = getKeyboardResizeDelta(event);
        const pair =
          delta === null
            ? null
            : measureMiniAppColumnPair(event.currentTarget, boundary);
        if (delta === null || !pair) {
          return;
        }

        event.preventDefault();
        onNudge(pair, delta);
      }}
      onLostPointerCapture={(event: PointerEvent<HTMLHRElement>) =>
        onDrag({ pointerId: event.pointerId, type: "cancelled" })
      }
      onPointerCancel={(event: PointerEvent<HTMLHRElement>) =>
        onDrag({ pointerId: event.pointerId, type: "cancelled" })
      }
      onPointerDown={(event: PointerEvent<HTMLHRElement>) => {
        if (event.button !== 0 || !event.isPrimary) {
          return;
        }

        const pair = measureMiniAppColumnPair(event.currentTarget, boundary);
        if (!pair) {
          return;
        }

        // Capture keeps the moves and the release coming here, and the resize
        // cursor showing, once the pointer leaves this narrow strip.
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onPress({ clientX: event.clientX, pair, pointerId: event.pointerId });
      }}
      onPointerMove={(event: PointerEvent<HTMLHRElement>) =>
        onDrag({
          clientX: event.clientX,
          pointerId: event.pointerId,
          type: "moved",
        })
      }
      onPointerUp={(event: PointerEvent<HTMLHRElement>) =>
        onDrag({ pointerId: event.pointerId, type: "released" })
      }
      ref={handleRef}
      tabIndex={0}
    />
  );
}

interface MiniAppColumnResize {
  layout: MiniAppColumnLayout;
  /** The handle for the leading edge of the column at `index`, if it has one. */
  renderHandle: (index: number) => ReactNode;
}

/**
 * Lays a table's columns out with the widths its reader chose, and offers a
 * handle on every edge two resizable columns share. Without a `control` the
 * table keeps its declared widths and gets no handles.
 *
 * The width a drag is passing through lives here, not in the control, so each
 * pointer move re-renders the table's header and columns but none of its rows;
 * the control, and whatever it persists to, hears once, on release.
 */
export function useMiniAppColumnResize(
  columns: Parameters<typeof resolveMiniAppColumnLayout>[0],
  control: MiniAppColumnWidthsControl | undefined,
): MiniAppColumnResize {
  const [state, setState] = useState(MINI_APP_COLUMN_RESIZE_IDLE);
  // Pointer events can outrun a render, so handlers read the state from here.
  const stateRef = useRef(state);
  const dragging = state.status === "dragging";

  const apply = useCallback((event: MiniAppColumnResizeEvent) => {
    const previous = stateRef.current;
    const next = transitionMiniAppColumnResize(previous, event);
    stateRef.current = next;
    setState(next);
    return getMiniAppColumnResizeCommit(previous, event);
  }, []);

  const abandon = useCallback(() => {
    const current = stateRef.current;
    if (current.status === "dragging") {
      apply({ pointerId: current.pointerId, type: "cancelled" });
    }
  }, [apply]);

  // Dragging across the rows would otherwise select their text.
  useEffect(() => {
    if (!dragging) {
      return;
    }

    const previous = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = previous;
    };
  }, [dragging]);

  const widths =
    control === undefined
      ? undefined
      : state.status === "dragging"
        ? state.widths
        : control.widths;
  const layout = resolveMiniAppColumnLayout(columns, widths);

  return {
    layout,
    renderHandle: (index) => {
      const boundary = layout.boundaries[index];
      if (!boundary || control === undefined) {
        return null;
      }

      return (
        <MiniAppColumnResizeHandle
          boundary={boundary}
          chosenLeft={
            boundary.left.fill ? undefined : widths?.[boundary.left.id]
          }
          dragging={
            state.status === "dragging" &&
            state.pair.left.id === boundary.left.id &&
            state.pair.right.id === boundary.right.id
          }
          onAbandon={abandon}
          onDrag={(event) => {
            const commit = apply(event);
            if (commit) {
              control.onChange(commit);
            }
          }}
          onNudge={(pair, delta) => {
            const traded = tradeMiniAppColumnWidths(pair, delta);
            if (Object.keys(traded).length > 0) {
              control.onChange({ ...control.widths, ...traded });
            }
          }}
          onPress={(press) =>
            apply({ ...press, base: control.widths, type: "pressed" })
          }
          onReset={() => {
            // Two quick short drags also end in a double-click; only two
            // presses that moved nothing ask for the declared widths back.
            if (!isMiniAppColumnResetDue(stateRef.current)) {
              return;
            }

            apply({ type: "reset" });
            control.onChange(
              resetMiniAppColumnWidths(control.widths, boundary),
            );
          }}
        />
      );
    },
  };
}
