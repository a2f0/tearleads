import { cn } from '@tearleads/ui';
import {
  WindowContextMenuItem,
  type WindowContextMenuItemProps
} from './WindowContextMenuItem.js';

export type DesktopContextMenuItemProps = WindowContextMenuItemProps;

export function DesktopContextMenuItem({
  className,
  ...props
}: DesktopContextMenuItemProps) {
  return (
    <WindowContextMenuItem
      {...props}
      className={cn('rounded-none px-3 text-left', className)}
    />
  );
}
