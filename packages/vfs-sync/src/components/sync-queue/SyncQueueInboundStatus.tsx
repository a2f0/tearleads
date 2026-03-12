import { useTranslation } from 'react-i18next';
import type { SyncQueueSnapshot } from '../../lib/queueDependencies';

interface SyncQueueInboundStatusProps {
  inbound: SyncQueueSnapshot['inbound'];
}

export function SyncQueueInboundStatus({
  inbound
}: SyncQueueInboundStatusProps) {
  const { t } = useTranslation('sync');

  return (
    <div className="bg-muted/50 flex flex-wrap items-center gap-x-4 gap-y-1 rounded px-3 py-2 font-mono text-xs">
      <span>
        <span className="text-muted-foreground">{t('cursor')}: </span>
        <span className="text-foreground">
          {inbound.cursor ? inbound.cursor.changeId.slice(0, 8) : t('noCursor')}
        </span>
      </span>
      <span>
        <span className="text-muted-foreground">{t('pendingOps')}: </span>
        <span className="text-foreground">{inbound.pendingOperations}</span>
      </span>
      <span>
        <span className="text-muted-foreground">{t('nextWriteId')}: </span>
        <span className="text-foreground">{inbound.nextLocalWriteId}</span>
      </span>
    </div>
  );
}
