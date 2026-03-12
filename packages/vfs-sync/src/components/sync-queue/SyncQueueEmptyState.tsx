import { useTranslation } from 'react-i18next';

export function SyncQueueEmptyState() {
  const { t } = useTranslation('sync');

  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <p className="font-medium text-muted-foreground text-sm">
        {t('noPendingOperations')}
      </p>
      <p className="mt-1 text-muted-foreground text-xs">{t('allSynced')}</p>
    </div>
  );
}
