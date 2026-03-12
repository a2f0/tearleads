import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@tearleads/ui';
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
    <WindowMenuBar>
      <DropdownMenu trigger="File">
        <DropdownMenuItem
          onClick={onRefresh}
          icon={<RefreshCw className="h-3 w-3" />}
        >
          Refresh
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>

      <DropdownMenu trigger="Go">
        <DropdownMenuItem
          onClick={() => onRouteChange(undefined)}
          icon={<Home className="h-3 w-3" />}
        >
          Overview
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {HEALTH_DRILLDOWN_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <DropdownMenuItem
              key={card.route}
              onClick={() => onRouteChange(card.route)}
              checked={activeRoute === card.route}
              icon={<Icon className="h-3 w-3" />}
            >
              {card.title}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenu>

      <DropdownMenu trigger="View">
        <DropdownMenuItem onClick={() => undefined} disabled>
          Options
        </DropdownMenuItem>
      </DropdownMenu>
    </WindowMenuBar>
  );
}
