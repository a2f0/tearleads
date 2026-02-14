import type { MenuKeys } from '@/i18n';
import { cn } from '@/lib/utils';
import type { AdminFlyoutItem } from './types';

interface SidebarAdminFlyoutMenuProps {
  isOpen: boolean;
  buttonRect: DOMRect | null;
  activePathname: string;
  items: AdminFlyoutItem[];
  ariaLabel: string;
  testIdPrefix: string;
  onItemClick: (path: string) => void;
  onItemContextMenu: (event: React.MouseEvent, path: string) => void;
  onOpenChange: (open: boolean) => void;
  t: (key: MenuKeys) => string;
}

export function SidebarAdminFlyoutMenu({
  isOpen,
  buttonRect,
  activePathname,
  items,
  ariaLabel,
  testIdPrefix,
  onItemClick,
  onItemContextMenu,
  onOpenChange,
  t
}: SidebarAdminFlyoutMenuProps) {
  if (!isOpen || !buttonRect) {
    return null;
  }

  return (
    <div
      className="fixed z-[70] min-w-44 pl-2"
      style={{
        left: buttonRect.right,
        top: buttonRect.top
      }}
      role="menu"
      aria-label={ariaLabel}
      data-testid={`${testIdPrefix}-flyout-menu`}
      onMouseEnter={() => onOpenChange(true)}
      onMouseLeave={() => onOpenChange(false)}
    >
      <div className="rounded-md border bg-background py-1 shadow-lg">
        {items.map((item) => {
          const SubIcon = item.icon;
          const isActive = activePathname.startsWith(item.path);
          return (
            <button
              key={item.path}
              type="button"
              data-testid={`${testIdPrefix}-flyout-${item.labelKey}`}
              onClick={() => onItemClick(item.path)}
              onContextMenu={(event) => onItemContextMenu(event, item.path)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
              role="menuitem"
            >
              <SubIcon className="h-4 w-4" />
              {t(item.labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
