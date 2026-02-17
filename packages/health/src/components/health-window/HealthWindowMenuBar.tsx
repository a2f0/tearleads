import { WindowMenuBar } from '@tearleads/window-manager';
import { Home, RefreshCw } from 'lucide-react';
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
      <div className="relative">
        <button
          type="button"
          className="rounded px-2 py-1 text-sm hover:bg-accent"
          onClick={() => toggleMenu('file')}
        >
          File
        </button>
        {openMenu === 'file' ? (
          <div
            role="menu"
            className="absolute left-0 z-50 mt-1 min-w-36 rounded border bg-popover p-1 shadow-md"
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
          </div>
        ) : null}
      </div>

      <div className="relative">
        <button
          type="button"
          className="rounded px-2 py-1 text-sm hover:bg-accent"
          onClick={() => toggleMenu('go')}
        >
          Go
        </button>
        {openMenu === 'go' ? (
          <div
            role="menu"
            className="absolute left-0 z-50 mt-1 min-w-44 rounded border bg-popover p-1 shadow-md"
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
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent"
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
          </div>
        ) : null}
      </div>

      <div className="relative">
        <button
          type="button"
          className="rounded px-2 py-1 text-sm hover:bg-accent"
          onClick={() => toggleMenu('view')}
        >
          View
        </button>
        {openMenu === 'view' ? (
          <div
            role="menu"
            className="absolute left-0 z-50 mt-1 min-w-36 rounded border bg-popover p-1 shadow-md"
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded px-2 py-1 text-left text-sm hover:bg-accent"
              onClick={closeMenus}
            >
              Options
            </button>
          </div>
        ) : null}
      </div>
    </WindowMenuBar>
  );
}
