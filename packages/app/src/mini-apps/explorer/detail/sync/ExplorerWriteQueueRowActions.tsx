import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { ClipboardIcon } from "@phosphor-icons/react/dist/csr/Clipboard";
import { CloudArrowDownIcon } from "@phosphor-icons/react/dist/csr/CloudArrowDown";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { Menu, MenuItem, type MenuPosition } from "@tearleads/windowing";
import { type MouseEvent, useCallback, useState } from "react";
import {
  MiniAppRowActionsButton,
  MiniAppTableCell,
} from "../../../../components/mini-app/MiniAppTable";
import { EXPLORER_LABELS } from "../../labels";

// A queued entry's overflow ("kebab") menu. Entry info drills into the
// write-queue entry detail — a diagnostics view that surfaces why the change is
// still queued. Kept separate from the row's primary tap (which opens the
// object) so inspecting a stuck write never navigates away to the document.
// Copy puts the entry's ids, status, and errors on the clipboard for a bug
// report.
export function WriteQueueRowActionsCell(params: {
  entryName: string;
  onCopy: () => void;
  onDiscard: (() => void) | null;
  onOpenEntryInfo: () => void;
  onRetry: () => void;
}) {
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const closeMenu = useCallback(() => setMenuPosition(null), []);
  const toggleMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setMenuPosition((current) => {
      if (current !== null) {
        return null;
      }
      // Anchor to the button's box (not the pointer) so keyboard activation,
      // which reports 0,0 client coordinates, still opens the menu under it.
      const rect = event.currentTarget.getBoundingClientRect();
      return { x: rect.left, y: rect.bottom };
    });
  }, []);
  // Name the entry in the trigger so a screen reader reading a column of
  // otherwise-identical kebabs can tell which row's actions each one opens.
  const label = `${EXPLORER_LABELS.writeQueueRowActionsLabel}: ${params.entryName}`;

  return (
    <MiniAppTableCell className="mini-app-row-actions-cell">
      <MiniAppRowActionsButton
        aria-expanded={menuPosition !== null}
        aria-label={label}
        onClick={toggleMenu}
        // Keep the trigger's mousedown from reaching the Menu's document-level
        // outside-click handler, so re-clicking the trigger can toggle it shut.
        onMouseDown={(event) => event.stopPropagation()}
        title={label}
      />
      {menuPosition ? (
        <Menu direction="down" onClose={closeMenu} position={menuPosition}>
          <MenuItem
            icon={InfoIcon}
            label={EXPLORER_LABELS.writeQueueEntryInfoAction}
            onClick={() => {
              closeMenu();
              params.onOpenEntryInfo();
            }}
          />
          <MenuItem
            icon={ArrowsClockwiseIcon}
            label={EXPLORER_LABELS.writeQueueRetryAction}
            onClick={() => {
              closeMenu();
              params.onRetry();
            }}
          />
          <MenuItem
            icon={ClipboardIcon}
            label={EXPLORER_LABELS.writeQueueCopyAction}
            onClick={() => {
              closeMenu();
              params.onCopy();
            }}
          />
          {params.onDiscard ? (
            <MenuItem
              icon={CloudArrowDownIcon}
              label={EXPLORER_LABELS.writeQueueDiscardAction}
              onClick={() => {
                closeMenu();
                params.onDiscard?.();
              }}
            />
          ) : null}
        </Menu>
      ) : null}
    </MiniAppTableCell>
  );
}
