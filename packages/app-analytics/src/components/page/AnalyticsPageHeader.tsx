import { BackLink, Button, RefreshButton } from '@tearleads/ui';
import { Trash2 } from 'lucide-react';

interface AnalyticsPageHeaderProps {
  showBackLink: boolean;
  isUnlocked: boolean;
  loading: boolean;
  hasEvents: boolean;
  onClear: () => void;
  onRefresh: () => void;
}

export function AnalyticsPageHeader({
  showBackLink,
  isUnlocked,
  loading,
  hasEvents,
  onClear,
  onRefresh
}: AnalyticsPageHeaderProps) {
  return (
    <div className="flex flex-col gap-2 pb-4">
      {showBackLink && <BackLink defaultTo="/" defaultLabel="Back to Home" />}
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-xl tracking-tight sm:text-2xl">
          Analytics
        </h1>
        {isUnlocked && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={onClear}
              disabled={loading || !hasEvents}
              aria-label="Clear events"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <RefreshButton onClick={onRefresh} loading={loading} />
          </div>
        )}
      </div>
    </div>
  );
}
