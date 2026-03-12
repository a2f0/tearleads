import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SyncQueueSnapshotBlobOp } from '../../lib/queueDependencies';
import { SyncQueueOperationRow } from './SyncQueueOperationRow';

interface SyncQueueBlobSectionProps {
  operations: SyncQueueSnapshotBlobOp[];
}

export function SyncQueueBlobSection({ operations }: SyncQueueBlobSectionProps) {
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
        <span className="text-foreground text-xs font-medium">
          {t('blobOperations')}
        </span>
        <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 font-mono text-[10px]">
          {operations.length}
        </span>
      </button>
      {expanded ? (
        <div className="pl-4">
          {operations.map((op) => {
            const detail = op.stagingId
              ? `staging:${op.stagingId.slice(0, 8)}`
              : op.itemId
                ? `item:${op.itemId.slice(0, 8)}`
                : undefined;
            return (
              <SyncQueueOperationRow
                key={op.operationId}
                kind={op.kind}
                id={op.operationId}
                detail={detail}
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
