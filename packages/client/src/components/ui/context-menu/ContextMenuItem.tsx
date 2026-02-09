import { WindowContextMenuItem } from '@rapid/window-manager';

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
    <WindowContextMenuItem
      icon={icon}
      onClick={onClick}
      className="rounded-none px-3 text-left"
      data-testid={testId}
    >
      {children}
    </WindowContextMenuItem>
  );
}
