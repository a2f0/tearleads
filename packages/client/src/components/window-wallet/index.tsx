import {
  WalletWindow as BaseWalletWindow,
  createWalletTracker,
  type WalletMediaFileOption,
  WalletRuntimeProvider
} from '@tearleads/app-wallet/clientEntry';
import { type ComponentProps, useCallback } from 'react';

import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { getDatabase } from '@/db';
import { useHostRuntimeDatabaseState } from '@/db/hooks';

type WalletWindowProps = ComponentProps<typeof BaseWalletWindow>;

export function WalletWindow(props: WalletWindowProps) {
  const databaseState = useHostRuntimeDatabaseState();
  const createTracker = useCallback(
    () => createWalletTracker(getDatabase()),
    []
  );
  // TODO: implement media preview loading
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
      <BaseWalletWindow {...props} />
    </WalletRuntimeProvider>
  );
}
