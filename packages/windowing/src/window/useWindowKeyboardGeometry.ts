import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { LiveGeometry } from "./useWindowGeometry";
import type { WindowMenuItem } from "./WindowMenuBar";

type WindowKeyboardMode = "move" | "resize";

const STEP_PX = 10;

const ARROW_DIRECTIONS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
};

const MODE_HINTS: Readonly<Record<WindowKeyboardMode, string>> = {
  move: "Moving window: arrow keys move it, Enter keeps it, Escape cancels.",
  resize:
    "Resizing window: arrow keys resize it, Enter keeps it, Escape cancels.",
};

interface KeyboardGeometryHost {
  available: boolean;
  windowRef: RefObject<HTMLDivElement | null>;
}

interface SteppedGeometry {
  commit: () => void;
  grow: (deltaWidth: number, deltaHeight: number) => void;
  nudge: (deltaX: number, deltaY: number) => void;
  restore: (saved: LiveGeometry) => void;
  snapshot: () => LiveGeometry;
}

// Keyboard move and resize, entered from the window's View menu the way a
// desktop system menu offers them. Arrow keys step the window, Enter keeps the
// result, and Escape puts it back. Keys are captured only while a mode is
// active, so no shortcut competes with text editing inside the window. The
// mode focuses its window and ends, keeping the result, as soon as focus or a
// pointer press goes anywhere else; minimizing or maximizing the window
// cancels it, so its key capture never outlives the window it moves.
function useWindowKeyboardGeometry(
  { commit, grow, nudge, restore, snapshot }: SteppedGeometry,
  { available, windowRef }: KeyboardGeometryHost,
  announce: (message: string) => void,
) {
  const [mode, setMode] = useState<WindowKeyboardMode | null>(null);
  const startGeometry = useRef<LiveGeometry | null>(null);

  const startKeyboardMode = useCallback(
    (nextMode: WindowKeyboardMode) => {
      startGeometry.current = snapshot();
      setMode(nextMode);
      announce(MODE_HINTS[nextMode]);
      windowRef.current?.focus({ preventScroll: true });
    },
    [announce, snapshot, windowRef],
  );

  useEffect(() => {
    if (available || !mode) {
      return;
    }
    if (startGeometry.current) {
      restore(startGeometry.current);
    }
    setMode(null);
  }, [available, mode, restore]);

  useEffect(() => {
    if (!mode) {
      return;
    }

    function leave() {
      commit();
      setMode(null);
    }

    function handleFocusIn(event: FocusEvent) {
      const root = windowRef.current;
      if (
        root &&
        event.target instanceof Node &&
        !root.contains(event.target)
      ) {
        leave();
      }
    }

    function finish(event: KeyboardEvent, keep: boolean) {
      event.preventDefault();
      event.stopPropagation();
      if (keep) {
        commit();
      } else if (startGeometry.current) {
        restore(startGeometry.current);
      }
      setMode(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      const direction = ARROW_DIRECTIONS[event.key];
      if (direction) {
        event.preventDefault();
        event.stopPropagation();
        const [x, y] = direction;
        if (mode === "move") {
          nudge(x * STEP_PX, y * STEP_PX);
        } else {
          grow(x * STEP_PX, y * STEP_PX);
        }
        return;
      }
      if (event.key === "Enter") {
        finish(event, true);
      } else if (event.key === "Escape") {
        finish(event, false);
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", leave, true);
    document.addEventListener("focusin", handleFocusIn, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", leave, true);
      document.removeEventListener("focusin", handleFocusIn, true);
    };
  }, [commit, grow, mode, nudge, restore, windowRef]);

  return startKeyboardMode;
}

// The View menu entries that start keyboard move and resize.
export function useWindowGeometryMenuItems(
  stepped: SteppedGeometry,
  {
    maximized,
    minimized,
    windowRef,
  }: {
    maximized: boolean;
    minimized: boolean;
    windowRef: RefObject<HTMLDivElement | null>;
  },
  announce: (message: string) => void,
): WindowMenuItem[] {
  const startKeyboardMode = useWindowKeyboardGeometry(
    stepped,
    { available: !maximized && !minimized, windowRef },
    announce,
  );
  return useMemo(
    () => [
      {
        disabled: maximized,
        id: "keyboard-move",
        label: "Move Window",
        onClick: () => startKeyboardMode("move"),
      },
      {
        disabled: maximized,
        id: "keyboard-resize",
        label: "Resize Window",
        onClick: () => startKeyboardMode("resize"),
      },
    ],
    [maximized, startKeyboardMode],
  );
}

// Moves focus into a window when it opens or comes back from minimized, unless
// focus is already inside it, such as an autofocused field. `shown` must only
// turn true once the window is laid out and visible: browsers ignore focus on
// an element that is still `visibility: hidden`.
export function useFocusWindowOnShow(
  windowRef: RefObject<HTMLDivElement | null>,
  shown: boolean,
) {
  const hidden = useRef(true);

  useEffect(() => {
    if (!shown) {
      hidden.current = true;
      return;
    }
    if (!hidden.current) {
      return;
    }
    hidden.current = false;
    const root = windowRef.current;
    if (root && !root.contains(document.activeElement)) {
      root.focus({ preventScroll: true });
    }
  }, [shown, windowRef]);
}
