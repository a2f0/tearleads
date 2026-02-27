import { Loader2 } from 'lucide-react';
import { InlineUnlock } from '../sqlite/InlineUnlock';

interface WalletItemLoadingStatesProps {
  isUnlocked: boolean;
  loadingDetail: boolean;
}

export function WalletItemLoadingStates({
  isUnlocked,
  loadingDetail
}: WalletItemLoadingStatesProps): React.ReactElement | null {
  if (!isUnlocked) {
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
