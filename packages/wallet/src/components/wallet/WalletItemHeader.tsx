import { Button } from '@tearleads/ui';
import { Plus, Save, Trash2 } from 'lucide-react';
import {
  getWalletItemTypeLabel,
  type WalletItemType
} from '../../lib/walletData';

interface WalletItemHeaderProps {
  isNewItem: boolean;
  resolvedDisplayName: string;
  itemType: WalletItemType;
  saving: boolean;
  deleting: boolean;
  onSave: () => void;
  onDelete: () => void;
  onCreateItem?: (() => void) | undefined;
}

export function WalletItemHeader({
  isNewItem,
  resolvedDisplayName,
  itemType,
  saving,
  deleting,
  onSave,
  onDelete,
  onCreateItem
}: WalletItemHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-semibold text-xl">
          {isNewItem ? 'New Wallet Item' : resolvedDisplayName || 'Wallet Item'}
        </h2>
        {!isNewItem && (
          <p className="text-muted-foreground text-sm">
            {getWalletItemTypeLabel(itemType)}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onCreateItem && !isNewItem && (
          <Button variant="outline" onClick={onCreateItem}>
            <Plus className="mr-2 h-4 w-4" />
            New Item
          </Button>
        )}
        {!isNewItem && (
          <Button
            variant="destructive"
            onClick={onDelete}
            disabled={deleting || saving}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        )}
        <Button onClick={onSave} disabled={saving || deleting}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
