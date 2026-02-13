import { ChevronRight } from 'lucide-react';
import type { MenuKeys } from '@/i18n';
import { cn } from '@/lib/utils';
import type { AdminFlyoutItem, NavItem } from './types';

interface SidebarNavListProps {
  items: NavItem[];
  isDesktop: boolean;
  activePathname: string;
  adminFlyoutItems: AdminFlyoutItem[];
  adminButtonRef: React.RefObject<HTMLButtonElement | null>;
  onAdminFlyoutOpenChange: (open: boolean) => void;
  onAdminButtonRectChange: (rect: DOMRect | null) => void;
  onItemClick: (path: string) => void;
  onItemContextMenu: (event: React.MouseEvent, path: string) => void;
  t: (key: MenuKeys) => string;
}

const NAV_BUTTON_CLASSES =
  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left font-medium text-sm transition-colors';

export function SidebarNavList({
  items,
  isDesktop,
  activePathname,
  adminFlyoutItems,
  adminButtonRef,
  onAdminFlyoutOpenChange,
  onAdminButtonRectChange,
  onItemClick,
  onItemContextMenu,
  t
}: SidebarNavListProps) {
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const Icon = item.icon;
        const isAdminFlyout = isDesktop && item.path === '/admin';
        const isAdminActive =
          isAdminFlyout &&
          adminFlyoutItems.some((subItem) =>
            activePathname.startsWith(subItem.path)
          );
        const isActive =
          isAdminActive ||
          (item.path === '/'
            ? activePathname === '/'
            : activePathname.startsWith(item.path));

        if (isAdminFlyout) {
          return (
            <li
              key={item.path}
              onMouseEnter={() => {
                onAdminFlyoutOpenChange(true);
                const rect =
                  adminButtonRef.current?.getBoundingClientRect() ?? null;
                onAdminButtonRectChange(rect);
              }}
              onMouseLeave={() => onAdminFlyoutOpenChange(false)}
            >
              <button
                ref={adminButtonRef}
                type="button"
                data-testid={item.testId}
                onClick={() => onItemClick(item.path)}
                onContextMenu={(event) => onItemContextMenu(event, item.path)}
                className={cn(
                  NAV_BUTTON_CLASSES,
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
                aria-haspopup="menu"
              >
                <Icon className="h-5 w-5" />
                {t(item.labelKey)}
                <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
              </button>
            </li>
          );
        }

        return (
          <li key={item.path}>
            <button
              type="button"
              data-testid={item.testId}
              onClick={() => onItemClick(item.path)}
              onContextMenu={(event) => onItemContextMenu(event, item.path)}
              className={cn(
                NAV_BUTTON_CLASSES,
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className="h-5 w-5" />
              {t(item.labelKey)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
