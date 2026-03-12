import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getSyncQueueDependencies,
  type SyncQueueSnapshot
} from '../../lib/queueDependencies';
import { SyncQueueBlobSection } from './SyncQueueBlobSection';
import { SyncQueueCrdtSection } from './SyncQueueCrdtSection';
import { SyncQueueEmptyState } from './SyncQueueEmptyState';
import { SyncQueueInboundStatus } from './SyncQueueInboundStatus';

const EMPTY_SNAPSHOT: SyncQueueSnapshot = {
  outbound: { crdt: [], blob: [] },
  inbound: { cursor: null, pendingOperations: 0, nextLocalWriteId: 0 }
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
        <h3 className="text-foreground mb-1 text-xs font-medium">
          {t('inboundStatus')}
        </h3>
        <SyncQueueInboundStatus inbound={snapshot.inbound} />
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
    </div>
  );
}
