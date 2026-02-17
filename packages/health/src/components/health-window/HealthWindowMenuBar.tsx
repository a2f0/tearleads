import { cn, WindowMenuBar } from '@tearleads/window-manager';
import { Home, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  HEALTH_DRILLDOWN_CARDS,
  type HealthDrilldownRoute
} from '../../pages/Health';

interface HealthWindowMenuBarProps {
  activeRoute: HealthDrilldownRoute | undefined;
  onRouteChange: (route: HealthDrilldownRoute | undefined) => void;
  onRefresh: () => void;
  onClose: () => void;
}

interface MenuDropdownProps {
  isOpen: boolean;
  label: string;
  minWidthClassName: string;
  onToggle: () => void;
  children: ReactNode;
}

function MenuDropdown({
  isOpen,
  label,
  minWidthClassName,
  onToggle,
  children
}: MenuDropdownProps) {
  return (
    <div className="relative">
      <button
        type="button"
        className="rounded px-2 py-1 text-sm hover:bg-accent"
        onClick={onToggle}
      >
        {label}
      </button>
      {isOpen ? (
        <div
          role="menu"
          className={cn(
            'absolute left-0 z-50 mt-1 rounded border bg-popover p-1 shadow-md',
            minWidthClassName
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function HealthWindowMenuBar({
  activeRoute,
  onRouteChange,
  onRefresh,
  onClose
}: HealthWindowMenuBarProps) {
  const [openMenu, setOpenMenu] = useState<'file' | 'go' | 'view' | null>(null);

  const toggleMenu = (menu: 'file' | 'go' | 'view') => {
    setOpenMenu((current) => (current === menu ? null : menu));
  };

  const closeMenus = () => {
    setOpenMenu(null);
  };

  return (
    <WindowMenuBar>
      <MenuDropdown
        isOpen={openMenu === 'file'}
        label="File"
        minWidthClassName="min-w-36"
        onToggle={() => toggleMenu('file')}
      >
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent"
          onClick={() => {
            onRefresh();
            closeMenus();
          }}
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
        <div className="my-1 border-t" />
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center rounded px-2 py-1 text-left text-sm hover:bg-accent"
          onClick={() => {
            onClose();
            closeMenus();
          }}
        >
          Close
        </button>
      </MenuDropdown>

      <MenuDropdown
        isOpen={openMenu === 'go'}
        label="Go"
        minWidthClassName="min-w-44"
        onToggle={() => toggleMenu('go')}
      >
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent"
          onClick={() => {
            onRouteChange(undefined);
            closeMenus();
          }}
        >
          <Home className="h-3 w-3" />
          Overview
        </button>
        <div className="my-1 border-t" />
        {HEALTH_DRILLDOWN_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.route}
              type="button"
              role="menuitem"
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent',
                activeRoute === card.route ? 'font-medium' : undefined
              )}
              onClick={() => {
                onRouteChange(card.route);
                closeMenus();
              }}
            >
              <Icon className="h-3 w-3" />
              {card.title}
              {activeRoute === card.route ? (
                <span className="ml-auto text-xs">✓</span>
              ) : null}
            </button>
          );
        })}
      </MenuDropdown>

      <MenuDropdown
        isOpen={openMenu === 'view'}
        label="View"
        minWidthClassName="min-w-36"
        onToggle={() => toggleMenu('view')}
      >
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center rounded px-2 py-1 text-left text-sm hover:bg-accent"
          onClick={closeMenus}
        >
          Options
        </button>
      </MenuDropdown>
    </WindowMenuBar>
  );
}
