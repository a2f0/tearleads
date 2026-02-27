import {
  WalletWindow as BaseWalletWindow,
  createWalletTracker,
  type WalletMediaFileOption,
  WalletRuntimeProvider
} from '@tearleads/wallet';
import { type ComponentProps, useCallback } from 'react';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';

type WalletWindowProps = ComponentProps<typeof BaseWalletWindow>;

export function WalletWindow(props: WalletWindowProps) {
  const { isUnlocked, currentInstanceId } = useDatabaseContext();
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
      isUnlocked={isUnlocked}
      currentInstanceId={currentInstanceId}
      createTracker={createTracker}
      loadMediaPreview={loadMediaPreview}
    >
      <BaseWalletWindow {...props} />
    </WalletRuntimeProvider>
  );
}
