import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";

const LONG_PRESS_DELAY_MS = 450;
/** Cancel the press if the finger drifts past this many px (a scroll, not a hold). */
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
/** Drop the click-suppressor if no synthesized click arrives within this window. */
const SYNTHESIZED_CLICK_WINDOW_MS = 700;

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
 * After the long press fires we register a one-shot capturing `click` listener
 * on `window` to swallow the click the browser synthesizes on touch release —
 * `preventDefault()` on `pointerup` does NOT suppress that click per the Pointer
 * Events spec, so without this the element's `onClick` (navigate/select) would
 * also run.
 *
 * Pass `enabled: false` (e.g. when no context-menu handler is wired) to make the
 * returned handlers no-ops.
 */
export function useLongPress(enabled: boolean): LongPressHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const removeClickSuppressorRef = useRef<(() => void) | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
  }, []);

  // Swallow exactly the next click (the one the browser synthesizes from the
  // touch release after a long press) and then detach. A timeout detaches the
  // suppressor if that click never arrives, so a later genuine tap still works.
  const armClickSuppressor = useCallback(() => {
    removeClickSuppressorRef.current?.();

    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const onClickCapture = (clickEvent: MouseEvent) => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      removeClickSuppressorRef.current?.();
    };

    const remove = () => {
      window.removeEventListener("click", onClickCapture, true);
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      removeClickSuppressorRef.current = null;
    };

    removeClickSuppressorRef.current = remove;
    window.addEventListener("click", onClickCapture, true);
    fallbackTimer = setTimeout(remove, SYNTHESIZED_CLICK_WINDOW_MS);
  }, []);

  useEffect(
    () => () => {
      clearTimer();
      removeClickSuppressorRef.current?.();
    },
    [clearTimer],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.pointerType !== "touch") {
        return;
      }

      clearTimer();
      originRef.current = { x: event.clientX, y: event.clientY };
      const element = event.currentTarget;
      const clientX = event.clientX;
      const clientY = event.clientY;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        armClickSuppressor();
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
    [armClickSuppressor, clearTimer, enabled],
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

  return {
    onPointerCancel: clearTimer,
    onPointerDown,
    onPointerMove,
    onPointerUp: clearTimer,
  };
}
