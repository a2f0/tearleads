import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
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

/**
 * Reads the two columns a handle sits between from the header cells drawn:
 * the handle's own cell is the right-hand column, the cell before it the left.
 */
function measureMiniAppColumnPair(
  handle: Element,
  boundary: MiniAppColumnBoundary,
): MiniAppColumnResizePair | null {
  const right = handle.closest("th");
  const left = right?.previousElementSibling;
  if (!right || !left) {
    return null;
  }

  return {
    left: {
      fill: boundary.left.fill,
      id: boundary.left.id,
      width: left.getBoundingClientRect().width,
    },
    right: {
      fill: boundary.right.fill,
      id: boundary.right.id,
      width: right.getBoundingClientRect().width,
    },
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
 * The handle on the edge two columns share. It is a focusable separator, as the
 * sidebar's is: drag it, or use the arrow keys (Shift for larger steps, Home
 * and End for the limits), and double-click it to give both columns back the
 * widths they declare.
 */
function MiniAppColumnResizeHandle({
  boundary,
  dragging,
  onAbandon,
  onDrag,
  onNudge,
  onPress,
  onReset,
}: MiniAppColumnResizeHandleProps) {
  const handleRef = useRef<HTMLHRElement>(null);
  const [measured, setMeasured] = useState({ left: 0, total: 0 });

  const measure = useCallback(() => {
    const handle = handleRef.current;
    const pair = handle ? measureMiniAppColumnPair(handle, boundary) : null;
    if (!pair) {
      return;
    }

    const left = Math.round(pair.left.width);
    const total = Math.round(pair.left.width + pair.right.width);
    setMeasured((current) =>
      current.left === left && current.total === total
        ? current
        : { left, total },
    );
  }, [boundary]);

  // A separator announces its position, which only layout knows, so read it
  // back after every render: any of them may have moved the columns.
  useLayoutEffect(measure);

  // A handle that leaves mid-drag (the table folded, or lost its columns) can
  // no longer deliver the release, so it ends the drag without storing it.
  useEffect(() => (dragging ? onAbandon : undefined), [dragging, onAbandon]);

  return (
    <hr
      aria-label={`Resize ${boundary.left.label} and ${boundary.right.label} columns`}
      aria-orientation="vertical"
      aria-valuemax={Math.max(
        MINI_APP_COLUMN_MIN_WIDTH,
        measured.total - MINI_APP_COLUMN_MIN_WIDTH,
      )}
      aria-valuemin={MINI_APP_COLUMN_MIN_WIDTH}
      aria-valuenow={measured.left}
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

  // A browser reports any two clicks in quick succession on a handle as a
  // double-click, including the clicks that end two short drags. Only two
  // presses that moved nothing are a request to reset.
  const stillPressesRef = useRef(0);

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

  const layout = resolveMiniAppColumnLayout(
    columns,
    control === undefined
      ? undefined
      : state.status === "dragging"
        ? state.widths
        : control.widths,
  );

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
          dragging={
            state.status === "dragging" &&
            state.pair.left.id === boundary.left.id &&
            state.pair.right.id === boundary.right.id
          }
          onAbandon={abandon}
          onDrag={(event) => {
            const commit = apply(event);
            if (event.type === "released") {
              stillPressesRef.current = commit
                ? 0
                : stillPressesRef.current + 1;
            }
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
            if (stillPressesRef.current < 2) {
              return;
            }

            stillPressesRef.current = 0;
            control.onChange(
              resetMiniAppColumnWidths(control.widths, boundary),
            );
          }}
        />
      );
    },
  };
}
