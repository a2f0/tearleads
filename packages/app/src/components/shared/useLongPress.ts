import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";

const LONG_PRESS_DELAY_MS = 450;
/** Cancel the press if the finger drifts past this many px (a scroll, not a hold). */
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

interface LongPressHandlers {
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
}

/**
 * Returns pointer handlers that, when a **touch** pointer is held still for
 * {@link LONG_PRESS_DELAY_MS}, dispatch a native `contextmenu` event on the
 * pressed element at the touch point.
 *
 * Dispatching the real event (rather than calling a handler directly) means the
 * element's existing `onContextMenu` — the same one a right-click triggers —
 * fires with a genuine event, so touch reuses the desktop context-menu path
 * verbatim. Mouse and pen pointers are ignored so right-click stays the desktop
 * affordance.
 *
 * Pass `enabled: false` (e.g. when no context-menu handler is wired) to make the
 * returned handlers no-ops.
 */
export function useLongPress(enabled: boolean): LongPressHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.pointerType !== "touch") {
        return;
      }

      clearTimer();
      firedRef.current = false;
      originRef.current = { x: event.clientX, y: event.clientY };
      const element = event.currentTarget;
      const clientX = event.clientX;
      const clientY = event.clientY;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        firedRef.current = true;
        element.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
          }),
        );
      }, LONG_PRESS_DELAY_MS);
    },
    [clearTimer, enabled],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const origin = originRef.current;
      if (!origin) {
        return;
      }

      const movedTooFar =
        Math.abs(event.clientX - origin.x) > LONG_PRESS_MOVE_TOLERANCE_PX ||
        Math.abs(event.clientY - origin.y) > LONG_PRESS_MOVE_TOLERANCE_PX;
      if (movedTooFar) {
        clearTimer();
      }
    },
    [clearTimer],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      // A completed long-press already opened the menu; swallow the click that
      // a touch release would otherwise synthesize so it doesn't also select.
      if (firedRef.current) {
        event.preventDefault();
        firedRef.current = false;
      }
      clearTimer();
    },
    [clearTimer],
  );

  return {
    onPointerCancel: clearTimer,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
