import { formatNumber, formatTimestamp } from '@admin/lib/utils';
import { Button } from '@/components/ui/button';
import { useTypedTranslation } from '@/i18n';
import type { api } from '@/lib/api';

type AdminUser = NonNullable<
  Awaited<ReturnType<typeof api.adminV2.users.get>>['user']
>;

interface AdminUserAiUsageProps {
  user: AdminUser;
  onViewAiRequests: () => void;
}

function formatUsageCount(value: number | bigint | undefined): string {
  return value === undefined ? '—' : formatNumber(value);
}

export function AdminUserAiUsage({
  user,
  onViewAiRequests
}: AdminUserAiUsageProps) {
  const { t } = useTypedTranslation('admin');
  const accounting = user.accounting;

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
            {formatUsageCount(accounting?.totalTokens)}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Prompt Tokens
          </p>
          <p className="mt-1 font-semibold text-lg">
            {formatUsageCount(accounting?.totalPromptTokens)}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Completion Tokens
          </p>
          <p className="mt-1 font-semibold text-lg">
            {formatUsageCount(accounting?.totalCompletionTokens)}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Requests
          </p>
          <p className="mt-1 font-semibold text-lg">
            {formatUsageCount(accounting?.requestCount)}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Last Usage
          </p>
          <p className="mt-1 text-muted-foreground text-sm">
            {formatTimestamp(accounting?.lastUsedAt)}
          </p>
        </div>
      </div>
    </div>
  );
}
