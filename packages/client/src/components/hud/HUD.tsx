import { X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { AnalyticsTab } from './AnalyticsTab';
import { LogsTab } from './LogsTab';

type TabId = 'analytics' | 'logs';

const TABS: { id: TabId; label: string }[] = [
  { id: 'analytics', label: 'Analytics' },
  { id: 'logs', label: 'Logs' }
];

interface HUDProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HUD({ isOpen, onClose }: HUDProps) {
  const [activeTab, setActiveTab] = useState<TabId>('analytics');

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
        data-testid="hud-backdrop"
      />
      <div
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[70vh] flex-col overflow-hidden rounded-t-lg border bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80 md:inset-x-auto md:right-4 md:bottom-16 md:w-[min(400px,calc(100vw-2rem))] md:rounded-lg"
        role="dialog"
        aria-modal="true"
        aria-label="Head's Up Display"
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex gap-1">
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
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close HUD"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-3">
          {activeTab === 'analytics' && <AnalyticsTab />}
          {activeTab === 'logs' && <LogsTab />}
        </div>
      </div>
    </>
  );
}
