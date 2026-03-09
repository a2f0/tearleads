import {
  AboutMenuItem,
  cn,
  DropdownMenu,
  DropdownMenuItem
} from '@tearleads/ui';
import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlBar,
  type WindowDimensions,
  WindowMenuBar
} from '@tearleads/window-manager';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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

type TabId = 'analytics' | 'logs' | 'notifications';

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
  const { t } = useTranslation();
  const { t: tMenu } = useTranslation('menu');
  const { t: tCommon } = useTranslation('common');

  const tabs: { id: TabId; labelKey: string }[] = [
    { id: 'analytics', labelKey: 'analytics' },
    { id: 'logs', labelKey: 'logs' },
    { id: 'notifications', labelKey: 'notifications' }
  ];

  return (
    <FloatingWindow
      id={id}
      title={tMenu('notificationCenter')}
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
        <WindowMenuBar>
          <DropdownMenu trigger={tMenu('file')}>
            <DropdownMenuItem onClick={onClose}>
              {tCommon('close')}
            </DropdownMenuItem>
          </DropdownMenu>
          <DropdownMenu trigger={tMenu('help')}>
            <AboutMenuItem
              appName={tMenu('notificationCenter')}
              closeLabel={tCommon('close')}
            />
          </DropdownMenu>
        </WindowMenuBar>
        <WindowControlBar>{null}</WindowControlBar>

        {/* Tab navigation */}
        <div className="flex items-center gap-1 border-b px-3 py-2 [border-color:var(--soft-border)]">
          {tabs.map((tab) => (
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
              {t(`menu:${tab.labelKey}`)}
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
