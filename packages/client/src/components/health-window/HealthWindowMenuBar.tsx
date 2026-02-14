import { Home, RefreshCw } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';
import {
  HEALTH_DRILLDOWN_CARDS,
  type HealthDrilldownRoute
} from '@/pages/Health';

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
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem
          icon={<RefreshCw className="h-3 w-3" />}
          onClick={onRefresh}
        >
          Refresh
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="Go">
        <DropdownMenuItem
          icon={<Home className="h-3 w-3" />}
          onClick={() => onRouteChange(undefined)}
          checked={activeRoute === undefined}
        >
          Overview
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {HEALTH_DRILLDOWN_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <DropdownMenuItem
              key={card.route}
              icon={<Icon className="h-3 w-3" />}
              onClick={() => onRouteChange(card.route)}
              checked={activeRoute === card.route}
            >
              {card.title}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <WindowOptionsMenuItem />
      </DropdownMenu>
    </div>
  );
}
