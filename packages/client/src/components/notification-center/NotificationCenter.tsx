import { WindowControlBar } from '@tearleads/window-manager';
import { useState } from 'react';
import {
  DesktopFloatingWindow as FloatingWindow,
  type WindowDimensions
} from '@tearleads/window-manager';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';
import { cn } from '@/lib/utils';
import { AnalyticsTab } from './AnalyticsTab';
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  MAX_HEIGHT_PERCENT,
  MAX_WIDTH_PERCENT,
  MIN_HEIGHT,
  MIN_WIDTH
} from './constants';
import { LogsTab } from './LogsTab';
import { NotificationsTab } from './NotificationsTab';

export type { Corner } from '@tearleads/window-manager';
export { MIN_HEIGHT, MIN_WIDTH } from './constants';

type TabId = 'analytics' | 'logs' | 'notifications';

const TABS: { id: TabId; label: string }[] = [
  { id: 'analytics', label: 'Analytics' },
  { id: 'logs', label: 'Logs' },
  { id: 'notifications', label: 'Notifications' }
];

interface NotificationCenterProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function NotificationCenter({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: NotificationCenterProps) {
  const [activeTab, setActiveTab] = useState<TabId>('logs');

  return (
    <FloatingWindow
      id={id}
      title="Notification Center"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={DEFAULT_WIDTH}
      defaultHeight={DEFAULT_HEIGHT}
      minWidth={MIN_WIDTH}
      minHeight={MIN_HEIGHT}
      maxWidthPercent={MAX_WIDTH_PERCENT}
      maxHeightPercent={MAX_HEIGHT_PERCENT}
    >
      <div className="flex h-full flex-col">
        {/* Menu bar */}
        <div className="flex shrink-0 border-b bg-muted/30 px-1">
          <DropdownMenu trigger="File">
            <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
          </DropdownMenu>
          <DropdownMenu trigger="Help">
            <AboutMenuItem appName="Notification Center" closeLabel="Close" />
          </DropdownMenu>
        </div>
        <WindowControlBar>{null}</WindowControlBar>

        {/* Tab navigation */}
        <div className="flex items-center gap-1 border-b px-3 py-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'rounded px-3 py-1 font-mono text-xs transition-colors',
                activeTab === tab.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-auto p-3">
          {activeTab === 'analytics' && <AnalyticsTab />}
          {activeTab === 'logs' && <LogsTab />}
          {activeTab === 'notifications' && <NotificationsTab />}
        </div>
      </div>
    </FloatingWindow>
  );
}
