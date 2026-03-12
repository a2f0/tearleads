import { cn } from '@tearleads/ui';
import { useTranslation } from 'react-i18next';

export type SyncWindowTab = 'account' | 'queue';

interface SyncWindowTabBarProps {
  activeTab: SyncWindowTab;
  onTabChange: (tab: SyncWindowTab) => void;
}

const TABS: { id: SyncWindowTab; labelKey: string }[] = [
  { id: 'account', labelKey: 'accountTab' },
  { id: 'queue', labelKey: 'queueTab' }
];

export function SyncWindowTabBar({
  activeTab,
  onTabChange
}: SyncWindowTabBarProps) {
  const { t } = useTranslation('sync');

  return (
    <div
      className="flex items-center gap-1 border-b px-3 py-2 [border-color:var(--soft-border)]"
      role="tablist"
    >
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'rounded px-3 py-1 font-mono text-xs transition-colors',
            activeTab === tab.id
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          {t(tab.labelKey)}
        </button>
      ))}
    </div>
  );
}
