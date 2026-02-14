import { ChevronRight } from 'lucide-react';
import type { MenuKeys } from '@/i18n';
import { cn } from '@/lib/utils';
import type { AdminFlyoutItem, NavItem } from './types';

interface SidebarNavListProps {
  items: NavItem[];
  isDesktop: boolean;
  activePathname: string;
  adminFlyoutItems: AdminFlyoutItem[];
  debugFlyoutItems: AdminFlyoutItem[];
  adminButtonRef: React.RefObject<HTMLButtonElement | null>;
  debugButtonRef: React.RefObject<HTMLButtonElement | null>;
  onAdminFlyoutOpenChange: (open: boolean) => void;
  onDebugFlyoutOpenChange: (open: boolean) => void;
  onAdminButtonRectChange: (rect: DOMRect | null) => void;
  onDebugButtonRectChange: (rect: DOMRect | null) => void;
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
  debugFlyoutItems,
  adminButtonRef,
  debugButtonRef,
  onAdminFlyoutOpenChange,
  onDebugFlyoutOpenChange,
  onAdminButtonRectChange,
  onDebugButtonRectChange,
  onItemClick,
  onItemContextMenu,
  t
}: SidebarNavListProps) {
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const Icon = item.icon;
        const isAdminFlyout = isDesktop && item.path === '/admin';
        const isDebugFlyout = isDesktop && item.path === '/debug';
        const isFlyout = isAdminFlyout || isDebugFlyout;
        const flyoutItems = isAdminFlyout ? adminFlyoutItems : debugFlyoutItems;
        const isFlyoutActive =
          isFlyout &&
          flyoutItems.some((subItem) =>
            activePathname.startsWith(subItem.path)
          );
        const isActive =
          isFlyoutActive ||
          (item.path === '/'
            ? activePathname === '/'
            : activePathname.startsWith(item.path));

        if (isFlyout) {
          const buttonRef = isAdminFlyout ? adminButtonRef : debugButtonRef;
          const onFlyoutOpenChange = isAdminFlyout
            ? onAdminFlyoutOpenChange
            : onDebugFlyoutOpenChange;
          const onButtonRectChange = isAdminFlyout
            ? onAdminButtonRectChange
            : onDebugButtonRectChange;

          return (
            <li
              key={item.path}
              onMouseEnter={() => {
                onFlyoutOpenChange(true);
                const rect = buttonRef.current?.getBoundingClientRect() ?? null;
                onButtonRectChange(rect);
              }}
              onMouseLeave={() => onFlyoutOpenChange(false)}
            >
              <button
                ref={buttonRef}
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
