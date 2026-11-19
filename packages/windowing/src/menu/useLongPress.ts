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

interface LongPressOptions {
  /**
   * Deliver the gesture as a mouse right-click arrives: a secondary-button
   * `mousedown`, then `contextmenu`, on the element the finger pressed rather
   * than the element holding these handlers. Open menus then close as they do
   * on any press outside them, and a control inside a wrapper sees the event
   * first, before it bubbles to the wrapper's menu. If the pressed element
   * left the page during the hold (an icon redrawn for a new state), the
   * element now under the finger receives both, or else the holder.
   */
  emulateRightClick?: boolean | undefined;
}

interface Point {
  x: number;
  y: number;
}

// The element to deliver to: the pressed element, else (when a re-render
// replaced it) the one now under the finger inside the holder, else the
// holder; null when even the holder has left the page.
function resolvePressedElement(
  pressed: Element | null,
  holder: HTMLElement,
  point: Point,
): Element | null {
  if (pressed?.isConnected) {
    return pressed;
  }
  const underFinger = pressed
    ? holder.ownerDocument.elementFromPoint(point.x, point.y)
    : null;
  if (underFinger && holder.contains(underFinger)) {
    return underFinger;
  }
  return holder.isConnected ? holder : null;
}

function deliverLongPress(
  element: Element,
  point: Point,
  emulateRightClick: boolean,
): void {
  const init = {
    bubbles: true,
    cancelable: true,
    clientX: point.x,
    clientY: point.y,
  };
  if (emulateRightClick) {
    element.dispatchEvent(
      new MouseEvent("mousedown", { ...init, button: 2, buttons: 2 }),
    );
  }
  element.dispatchEvent(new MouseEvent("contextmenu", init));
}

// On release a browser may send mousedown (which dismisses an outside menu)
// and click (which activates the trigger). Consume that gesture through click,
// and always yield to the next genuine pointer or keyboard interaction.
function suppressLongPressRelease(): () => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const remove = () => {
    clearTimeout(timeout);
    window.removeEventListener("mousedown", suppressMouse, true);
    window.removeEventListener("click", suppressMouse, true);
    window.removeEventListener("pointerup", expire, true);
    window.removeEventListener("pointercancel", remove, true);
    window.removeEventListener("pointerdown", remove, true);
    window.removeEventListener("keydown", remove, true);
  };
  const suppressMouse = (event: MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "click") remove();
  };
  const expire = () => {
    timeout = setTimeout(remove, SYNTHESIZED_CLICK_WINDOW_MS);
  };
  window.addEventListener("mousedown", suppressMouse, true);
  window.addEventListener("click", suppressMouse, true);
  window.addEventListener("pointerup", expire, { capture: true, once: true });
  window.addEventListener("pointercancel", remove, true);
  window.addEventListener("pointerdown", remove, true);
  window.addEventListener("keydown", remove, true);
  return remove;
}

/**
 * Returns pointer handlers that, when a **touch** pointer is held still for
 * {@link LONG_PRESS_DELAY_MS}, dispatch a native `contextmenu` event on the
 * element holding them at the touch point (or, with `emulateRightClick`, a
 * right-click's `mousedown` and `contextmenu` on the pressed element).
 *
 * Dispatching the real event (rather than calling a handler directly) means the
 * element's existing `onContextMenu` — the same one a right-click triggers —
 * fires with a genuine event, so touch reuses the desktop context-menu path
 * verbatim. Mouse and pen pointers are ignored so right-click stays the desktop
 * affordance.
 *
 * After the hold fires, consume the mouse events synthesized on touch release
 * so they cannot dismiss the menu or also activate its trigger.
 *
 * Pass `enabled: false` (e.g. when no context-menu handler is wired) to make the
 * returned handlers no-ops.
 */
export function useLongPress(
  enabled: boolean,
  options?: LongPressOptions,
): LongPressHandlers {
  const emulateRightClick = options?.emulateRightClick === true;
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

  // Tear down on unmount, and also when `enabled` flips off mid-press so a
  // scheduled long-press timer / click suppressor never fires after the hook
  // is disabled.
  useEffect(
    () => () => {
      clearTimer();
      removeClickSuppressorRef.current?.();
    },
    [clearTimer, enabled],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.pointerType !== "touch") {
        return;
      }

      clearTimer();
      const point = { x: event.clientX, y: event.clientY };
      originRef.current = point;
      const holder = event.currentTarget;
      const pressed =
        emulateRightClick && event.target instanceof Element
          ? event.target
          : null;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const element = resolvePressedElement(pressed, holder, point);
        if (element) {
          removeClickSuppressorRef.current?.();
          removeClickSuppressorRef.current = suppressLongPressRelease();
          deliverLongPress(element, point, emulateRightClick);
        }
      }, LONG_PRESS_DELAY_MS);
    },
    [clearTimer, emulateRightClick, enabled],
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
