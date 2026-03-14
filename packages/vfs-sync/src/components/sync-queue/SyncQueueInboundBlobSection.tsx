import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SyncQueueSnapshotInboundBlobOp } from '../../lib/queueDependencies';
import { SyncQueueOperationRow } from './SyncQueueOperationRow';

interface SyncQueueInboundBlobSectionProps {
  operations: SyncQueueSnapshotInboundBlobOp[];
}

export function SyncQueueInboundBlobSection({
  operations
}: SyncQueueInboundBlobSectionProps) {
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
          {t('inboundBlobDownloads')}
        </span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {operations.length}
        </span>
      </button>
      {expanded ? (
        <div className="pl-4">
          {operations.map((op) => {
            const detail = `blob:${op.blobId.slice(0, 8)}`;
            return (
              <SyncQueueOperationRow
                key={op.operationId}
                kind="download"
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
