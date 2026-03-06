import { WindowConnectionIndicator } from '@tearleads/window-manager';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useOptionalAuth } from '../contexts/AuthContext';
import { useVfsOrchestratorInstance } from '../contexts/VfsOrchestratorContext';
import {
  getSyncActivity,
  subscribeSyncActivity
} from '../lib/vfsItemSyncWriter';

const POLL_INTERVAL_MS = 2000;

export function VfsSyncStatusIndicator() {
  const { t } = useTranslation('tooltips');
  const auth = useOptionalAuth();
  const isAuthenticated = auth?.isAuthenticated ?? false;
  const orchestrator = useVfsOrchestratorInstance();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncActivity, setSyncActivity] = useState(getSyncActivity);

  useEffect(() => {
    const update = () => {
      setSyncActivity(getSyncActivity());
    };
    return subscribeSyncActivity(update);
  }, []);

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

  const { uploadInflightCount, downloadInflightCount, lastSyncError } =
    syncActivity;

  let state: 'connected' | 'connecting' | 'disconnected';
  let tooltip: string;

  if (uploadInflightCount > 0 && downloadInflightCount > 0) {
    state = 'connecting';
    tooltip = t('vfsSyncing');
  } else if (uploadInflightCount > 0) {
    state = 'connecting';
    tooltip = t('vfsUploading');
  } else if (downloadInflightCount > 0) {
    state = 'connecting';
    tooltip = t('vfsDownloading');
  } else if (lastSyncError) {
    state = 'disconnected';
    tooltip = t('vfsSyncError');
  } else if (pendingCount > 0) {
    state = 'disconnected';
    tooltip = t('vfsPendingSync', { count: pendingCount });
  } else {
    state = 'connected';
    tooltip = t('vfsSynced');
  }

  return <WindowConnectionIndicator state={state} tooltip={tooltip} />;
}
