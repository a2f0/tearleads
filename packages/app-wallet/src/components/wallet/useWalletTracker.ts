import { useMemo } from 'react';
import type { WalletTracker } from '../../lib/walletTracker';
import { useWalletRuntime } from '../../runtime';

export function useWalletTracker(): WalletTracker | null {
  const { createTracker, isUnlocked } = useWalletRuntime();

  const tracker = useMemo(() => {
    if (!isUnlocked) {
      return null;
    }

    return createTracker();
  }, [createTracker, isUnlocked]);

  return tracker;
}
