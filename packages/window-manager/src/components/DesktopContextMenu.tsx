import {
  WindowContextMenu,
  type WindowContextMenuProps
} from './WindowContextMenu.js';

export const DESKTOP_CONTEXT_MENU_OVERLAY_Z_INDEX = 9999;
export const DESKTOP_CONTEXT_MENU_Z_INDEX = 10000;

const DEFAULT_DESKTOP_CONTEXT_MENU_CLASS_NAME =
  'min-w-40 bg-background py-1 shadow-lg';

export type DesktopContextMenuProps = Omit<
  WindowContextMenuProps,
  'overlayZIndex' | 'menuZIndex' | 'menuClassName'
> & {
  menuClassName?: string | undefined;
};

export function DesktopContextMenu({
  menuClassName = DEFAULT_DESKTOP_CONTEXT_MENU_CLASS_NAME,
  ...props
}: DesktopContextMenuProps) {
  return (
    <WindowContextMenu
      {...props}
      overlayZIndex={DESKTOP_CONTEXT_MENU_OVERLAY_Z_INDEX}
      menuZIndex={DESKTOP_CONTEXT_MENU_Z_INDEX}
      menuClassName={menuClassName}
    />
  );
}
