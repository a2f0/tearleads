import { Loader2 } from 'lucide-react';
import { getWalletUiDependencies } from '../../lib/walletUiDependencies';

interface WalletItemLoadingStatesProps {
  isLoading: boolean;
  isUnlocked: boolean;
  loadingDetail: boolean;
}

export function WalletItemLoadingStates({
  isLoading,
  isUnlocked,
  loadingDetail
}: WalletItemLoadingStatesProps): React.ReactElement | null {
  const dependencies = getWalletUiDependencies();
  const InlineUnlock = dependencies?.InlineUnlock;

  if (isLoading) {
    return (
      <div className="rounded-lg border p-6 text-center text-muted-foreground">
        Loading database...
      </div>
    );
  }

  if (!isUnlocked) {
    if (!InlineUnlock) {
      return (
        <div className="rounded-lg border p-6 text-center text-muted-foreground">
          Wallet is not configured.
        </div>
      );
    }
    return <InlineUnlock description="this wallet item" />;
  }

  if (loadingDetail) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading wallet item...
      </div>
    );
  }

  return null;
}
