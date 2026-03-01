import { formatNumber, formatTimestamp } from '@admin/lib/utils';
import type { AdminUser } from '@tearleads/shared';
import { Button } from '@/components/ui/button';
import { useTypedTranslation } from '@/i18n';

interface AdminUserAiUsageProps {
  user: AdminUser;
  onViewAiRequests: () => void;
}

export function AdminUserAiUsage({
  user,
  onViewAiRequests
}: AdminUserAiUsageProps) {
  const { t } = useTypedTranslation('admin');

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-lg">{t('aiUsage')}</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onViewAiRequests}
        >
          View Requests
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Total Tokens
          </p>
          <p className="mt-1 font-semibold text-lg">
            {formatNumber(user.accounting.totalTokens)}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Prompt Tokens
          </p>
          <p className="mt-1 font-semibold text-lg">
            {formatNumber(user.accounting.totalPromptTokens)}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Completion Tokens
          </p>
          <p className="mt-1 font-semibold text-lg">
            {formatNumber(user.accounting.totalCompletionTokens)}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Requests
          </p>
          <p className="mt-1 font-semibold text-lg">
            {formatNumber(user.accounting.requestCount)}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Last Usage
          </p>
          <p className="mt-1 text-muted-foreground text-sm">
            {formatTimestamp(user.accounting.lastUsedAt)}
          </p>
        </div>
      </div>
    </div>
  );
}
