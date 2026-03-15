import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SyncQueueSnapshotOutboundBlobActivity } from '../../lib/queueDependencies';
import { SyncQueueOperationRow } from './SyncQueueOperationRow';

interface SyncQueueOutboundBlobActivityProps {
  operations: SyncQueueSnapshotOutboundBlobActivity[];
}

export function SyncQueueOutboundBlobActivity({
  operations
}: SyncQueueOutboundBlobActivityProps) {
  const { t } = useTranslation('sync');
  const [expanded, setExpanded] = useState(true);

  return (
    <section>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 py-1 text-left"
      >
        <span className="text-xs">{expanded ? '\u25BC' : '\u25B6'}</span>
        <span className="font-medium text-foreground text-xs">
          {t('outboundBlobActivity')}
        </span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {operations.length}
        </span>
      </button>
      {expanded ? (
        <div className="pl-4">
          {operations.map((op) => {
            const statusPrefix = op.success ? '\u2713' : '\u2717';
            const detail = `${statusPrefix} ${op.kind}${op.retryCount > 0 ? ` (${op.retryCount} retries)` : ''}`;
            return (
              <SyncQueueOperationRow
                key={op.operationId}
                kind={op.success ? 'done' : 'error'}
                id={op.operationId}
                detail={detail}
                timestamp={op.timestamp.slice(11, 19)}
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
