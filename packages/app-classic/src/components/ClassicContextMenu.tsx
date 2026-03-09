import type {
  ComponentType,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode
} from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { handleClassicContextMenuKeyDown } from './classicContextMenuKeyboard';

interface ClassicContextMenuAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
}

export interface ClassicContextMenuComponents {
  ContextMenu: ComponentType<{
    x: number;
    y: number;
    onClose: () => void;
    children: ReactNode;
  }>;
  ContextMenuItem: ComponentType<{
    onClick: () => void;
    children: ReactNode;
  }>;
}

interface ClassicContextMenuProps {
  x: number;
  y: number;
  ariaLabel: string;
  onClose: () => void;
  actions: ClassicContextMenuAction[];
  components?: ClassicContextMenuComponents;
}

export function ClassicContextMenu({
  x,
  y,
  ariaLabel,
  onClose,
  actions,
  components
}: ClassicContextMenuProps) {
  const { t } = useTranslation('classic');
  const standardContextMenu = components?.ContextMenu;
  const standardContextMenuItem = components?.ContextMenuItem;

  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [position, setPosition] = useState({ top: y, left: x });
  const standardMenuItemClassName =
    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm';

  useLayoutEffect(() => {
    if (standardContextMenu) {
      return;
    }
    if (!menuRef.current) {
      return;
    }

    const rect = menuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    if (x + rect.width > viewportWidth) {
      adjustedX = Math.max(0, viewportWidth - rect.width - 8);
    }

    if (y + rect.height > viewportHeight) {
      adjustedY = Math.max(0, viewportHeight - rect.height - 8);
    }

    setPosition({ top: adjustedY, left: adjustedX });
  }, [standardContextMenu, x, y]);

  useEffect(() => {
    if (standardContextMenu) {
      return;
    }
    const firstEnabled = itemRefs.current.find(
      (item) => item && !item.disabled
    );
    firstEnabled?.focus();
  }, [standardContextMenu]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    handleClassicContextMenuKeyDown(event, itemRefs);
  };

  if (standardContextMenu && standardContextMenuItem) {
    const StandardContextMenu = standardContextMenu;
    const StandardContextMenuItem = standardContextMenuItem;

    return (
      <StandardContextMenu x={x} y={y} onClose={onClose}>
        {actions.map((action) =>
          action.disabled ? (
            <button
              key={action.label}
              type="button"
              disabled
              aria-label={action.ariaLabel}
              className={`${standardMenuItemClassName} text-muted-foreground`}
            >
              {action.label}
            </button>
          ) : (
            <StandardContextMenuItem
              key={action.label}
              onClick={() => {
                action.onClick();
                onClose();
              }}
            >
              {action.label}
            </StandardContextMenuItem>
          )
        )}
      </StandardContextMenu>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[10000]">
      <button
        type="button"
        className="fixed inset-0 cursor-default"
        onClick={onClose}
        aria-label={t('closeContextMenu')}
      />
      <div
        ref={menuRef}
        role="menu"
        aria-label={ariaLabel}
        className="fixed z-[10001] min-w-[160px] rounded-md border bg-popover p-1 shadow-md"
        style={{ top: position.top, left: position.left }}
        onKeyDown={handleMenuKeyDown}
      >
        {actions.map((action, index) => (
          <button
            key={action.label}
            type="button"
            role="menuitem"
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground disabled:text-muted-foreground"
            disabled={action.disabled}
            onClick={() => {
              action.onClick();
              onClose();
            }}
            aria-label={action.ariaLabel}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}
