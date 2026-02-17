import { WindowMenuBar } from '@tearleads/window-manager';
import { Home, RefreshCw } from 'lucide-react';
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
  return (
    <WindowMenuBar className="flex flex-wrap gap-1 px-2 py-1">
      <button
        type="button"
        className="inline-flex items-center rounded border px-2 py-1 text-xs"
        onClick={onRefresh}
      >
        <RefreshCw className="mr-1 h-3 w-3" />
        Refresh
      </button>
      <button
        type="button"
        className="inline-flex items-center rounded border px-2 py-1 text-xs"
        onClick={() => onRouteChange(undefined)}
      >
        <Home className="mr-1 h-3 w-3" />
        Overview
      </button>
      {HEALTH_DRILLDOWN_CARDS.map((card) => {
        const Icon = card.icon;
        const isActive = activeRoute === card.route;
        return (
          <button
            key={card.route}
            type="button"
            className="inline-flex items-center rounded border px-2 py-1 text-xs"
            data-active={isActive ? 'true' : 'false'}
            onClick={() => onRouteChange(card.route)}
          >
            <Icon className="mr-1 h-3 w-3" />
            {card.title}
          </button>
        );
      })}
      <button
        type="button"
        className="inline-flex items-center rounded border px-2 py-1 text-xs"
        onClick={onClose}
      >
        Close
      </button>
    </WindowMenuBar>
  );
}
