import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getSyncQueueDependencies,
  type SyncQueueSnapshot
} from '../../lib/queueDependencies';
import { SyncQueueBlobSection } from './SyncQueueBlobSection';
import { SyncQueueCrdtSection } from './SyncQueueCrdtSection';
import { SyncQueueEmptyState } from './SyncQueueEmptyState';
import { SyncQueueInboundBlobSection } from './SyncQueueInboundBlobSection';
import { SyncQueueInboundStatus } from './SyncQueueInboundStatus';
import { SyncQueueOutboundBlobActivity } from './SyncQueueOutboundBlobActivity';

const EMPTY_SNAPSHOT: SyncQueueSnapshot = {
  outbound: { crdt: [], blob: [], blobActivity: [] },
  inbound: {
    cursor: null,
    pendingOperations: 0,
    nextLocalWriteId: 0,
    blobDownloads: []
  }
};

const POLL_INTERVAL_MS = 1000;

export function SyncQueueTab() {
  const { t } = useTranslation('sync');
  const deps = getSyncQueueDependencies();
  const snapshot = deps?.useSnapshot() ?? EMPTY_SNAPSHOT;
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const hasOutbound =
    snapshot.outbound.crdt.length > 0 || snapshot.outbound.blob.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="mb-1 font-medium text-foreground text-xs">
          {t('inboundStatus')}
        </h3>
        <SyncQueueInboundStatus inbound={snapshot.inbound} />
        {snapshot.inbound.blobDownloads.length > 0 ? (
          <div className="mt-2">
            <SyncQueueInboundBlobSection
              operations={snapshot.inbound.blobDownloads}
            />
          </div>
        ) : null}
      </div>

      {hasOutbound ? (
        <div className="flex flex-col gap-2">
          {snapshot.outbound.crdt.length > 0 ? (
            <SyncQueueCrdtSection operations={snapshot.outbound.crdt} />
          ) : null}
          {snapshot.outbound.blob.length > 0 ? (
            <SyncQueueBlobSection operations={snapshot.outbound.blob} />
          ) : null}
        </div>
      ) : (
        <SyncQueueEmptyState />
      )}

      {snapshot.outbound.blobActivity.length > 0 ? (
        <SyncQueueOutboundBlobActivity
          operations={snapshot.outbound.blobActivity}
        />
      ) : null}
    </div>
  );
}
