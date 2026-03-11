import {
  createWalletTracker,
  type WalletMediaFileOption,
  WalletRuntimeProvider
} from '@tearleads/app-wallet/clientEntry';
import { useCallback } from 'react';
import { Outlet } from 'react-router-dom';

import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { getDatabase } from '@/db';
import { useHostRuntimeDatabaseState } from '@/db/hooks/useHostRuntimeDatabaseState';

export function WalletPageLayout() {
  const databaseState = useHostRuntimeDatabaseState();
  const createTracker = useCallback(
    () => createWalletTracker(getDatabase()),
    []
  );
  const loadMediaPreview = useCallback(
    async (_file: WalletMediaFileOption, _instanceId: string | null) => null,
    []
  );

  return (
    <WalletRuntimeProvider
      databaseState={databaseState}
      createTracker={createTracker}
      loadMediaPreview={loadMediaPreview}
      InlineUnlock={InlineUnlock}
    >
      <Outlet />
    </WalletRuntimeProvider>
  );
}
