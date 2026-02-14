import { DesktopContextMenuItem } from '@tearleads/window-manager';

interface ContextMenuItemProps {
  icon?: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
  'data-testid'?: string;
}

export function ContextMenuItem({
  icon,
  onClick,
  children,
  'data-testid': testId
}: ContextMenuItemProps) {
  return (
    <DesktopContextMenuItem icon={icon} onClick={onClick} data-testid={testId}>
      {children}
    </DesktopContextMenuItem>
  );
}
