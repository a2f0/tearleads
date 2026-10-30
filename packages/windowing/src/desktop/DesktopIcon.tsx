import type { KeyboardEvent, MouseEvent } from "react";
import type { WindowingIcon } from "../icons/windowingIcon";
import type { DesktopIconPosition } from "./desktopState";
import {
  type ClampDesktopIcon,
  useDesktopIconDrag,
} from "./useDesktopIconDrag";

/** Where arrow, Home, and End keys move the selection. */
export type DesktopIconStep = "first" | "last" | "next" | "previous";

const STEP_KEYS: ReadonlyMap<string, DesktopIconStep> = new Map([
  ["ArrowDown", "next"],
  ["ArrowLeft", "previous"],
  ["ArrowRight", "next"],
  ["ArrowUp", "previous"],
  ["End", "last"],
  ["Home", "first"],
]);

interface DesktopIconProps {
  appId: string;
  clamp: ClampDesktopIcon;
  icon: WindowingIcon | undefined;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onMove: (position: DesktopIconPosition) => void;
  onOpen: () => void;
  onSelect: () => void;
  onStep: (step: DesktopIconStep) => void;
  position: DesktopIconPosition;
  selected: boolean;
  /** Whether Tab reaches this icon: the selected one, or else the first. */
  tabbable: boolean;
  title: string;
}

/**
 * One desktop icon, an option of the desktop's listbox: it selects on press,
 * opens on double-click or Enter, offers its menu on right-click or the
 * context-menu key, and moves when dragged by any pointer.
 */
export function DesktopIcon({
  appId,
  clamp,
  icon: Icon,
  onContextMenu,
  onMove,
  onOpen,
  onSelect,
  onStep,
  position,
  selected,
  tabbable,
  title,
}: DesktopIconProps) {
  const { dragPosition, handlers } = useDesktopIconDrag({
    clamp,
    onMove,
    onSelect,
    position,
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen();
      return;
    }
    const step = STEP_KEYS.get(event.key);
    if (step) {
      event.preventDefault();
      onStep(step);
    }
  };

  const shown = dragPosition ?? position;
  return (
    <button
      {...handlers}
      aria-selected={selected}
      className="desktop-icon"
      data-app-id={appId}
      data-dragging={dragPosition ? "" : undefined}
      onContextMenu={onContextMenu}
      onDoubleClick={onOpen}
      onFocus={onSelect}
      onKeyDown={handleKeyDown}
      role="option"
      style={{ left: shown.x, top: shown.y }}
      tabIndex={tabbable ? 0 : -1}
      type="button"
    >
      {Icon && (
        <Icon
          aria-hidden="true"
          className="desktop-icon-glyph"
          focusable="false"
          size={32}
        />
      )}
      <span className="desktop-icon-label">{title}</span>
    </button>
  );
}
