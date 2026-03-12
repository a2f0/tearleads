import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SyncQueueSnapshotCrdtOp } from '../../lib/queueDependencies';
import { SyncQueueOperationRow } from './SyncQueueOperationRow';

interface SyncQueueCrdtSectionProps {
  operations: SyncQueueSnapshotCrdtOp[];
}

export function SyncQueueCrdtSection({ operations }: SyncQueueCrdtSectionProps) {
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
          {t('crdtOperations')}
        </span>
        <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 font-mono text-[10px]">
          {operations.length}
        </span>
      </button>
      {expanded ? (
        <div className="pl-4">
          {operations.map((op) => (
            <SyncQueueOperationRow
              key={op.opId}
              kind={op.opType}
              id={op.opId}
              detail={
                op.encrypted ? t('encrypted') : `item:${op.itemId.slice(0, 8)}`
              }
              timestamp={op.occurredAt}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
