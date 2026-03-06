import { WindowConnectionIndicator } from '@tearleads/window-manager';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useOptionalAuth } from '../contexts/AuthContext';
import { useVfsOrchestratorInstance } from '../contexts/VfsOrchestratorContext';

const POLL_INTERVAL_MS = 2000;

export function VfsSyncStatusIndicator() {
  const { t } = useTranslation('tooltips');
  const auth = useOptionalAuth();
  const isAuthenticated = auth?.isAuthenticated ?? false;
  const orchestrator = useVfsOrchestratorInstance();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!orchestrator) {
      return;
    }

    const poll = () => {
      const crdtPending = orchestrator.crdt.snapshot().pendingOperations;
      const blobPending = orchestrator.blob.queuedOperations().length;
      setPendingCount(crdtPending + blobPending);
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [orchestrator]);

  if (!isAuthenticated || !orchestrator) {
    return null;
  }

  const isSynced = pendingCount === 0;

  return (
    <WindowConnectionIndicator
      state={isSynced ? 'connected' : 'disconnected'}
      tooltip={
        isSynced ? t('vfsSynced') : t('vfsPendingSync', { count: pendingCount })
      }
    />
  );
}
