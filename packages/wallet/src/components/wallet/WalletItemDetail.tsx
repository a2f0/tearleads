import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { InlineUnlock } from '@client/components/sqlite/InlineUnlock';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { useDatabaseContext } from '@client/db/hooks';
import {
  WALLET_ITEM_TYPES,
  getWalletItemDetail,
  getWalletItemTypeLabel,
  listWalletMediaFiles,
  saveWalletItem,
  softDeleteWalletItem,
  toDateInputValue,
  type SaveWalletItemResult,
  type WalletItemDetailRecord,
  type WalletItemType,
  type WalletMediaFileOption
} from '../../lib/walletData';

interface WalletItemDetailProps {
  itemId: string;
  onSaved?: (result: SaveWalletItemResult) => void;
  onDeleted?: (itemId: string) => void;
  onCreateItem?: () => void;
}

interface WalletItemFormState {
  itemType: WalletItemType;
  displayName: string;
  issuingAuthority: string;
  countryCode: string;
  documentNumberLast4: string;
  issuedOn: string;
  expiresOn: string;
  notes: string;
  frontFileId: string;
  backFileId: string;
}

const EMPTY_FORM_STATE: WalletItemFormState = {
  itemType: 'passport',
  displayName: '',
  issuingAuthority: '',
  countryCode: '',
  documentNumberLast4: '',
  issuedOn: '',
  expiresOn: '',
  notes: '',
  frontFileId: '',
  backFileId: ''
};

function detailToForm(detail: WalletItemDetailRecord): WalletItemFormState {
  return {
    itemType: detail.itemType,
    displayName: detail.displayName,
    issuingAuthority: detail.issuingAuthority ?? '',
    countryCode: detail.countryCode ?? '',
    documentNumberLast4: detail.documentNumberLast4 ?? '',
    issuedOn: toDateInputValue(detail.issuedOn),
    expiresOn: toDateInputValue(detail.expiresOn),
    notes: detail.notes ?? '',
    frontFileId: detail.frontFileId ?? '',
    backFileId: detail.backFileId ?? ''
  };
}

export function WalletItemDetail({
  itemId,
  onSaved,
  onDeleted,
  onCreateItem
}: WalletItemDetailProps) {
  const { isLoading, isUnlocked } = useDatabaseContext();
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [form, setForm] = useState<WalletItemFormState>(EMPTY_FORM_STATE);
  const [mediaFiles, setMediaFiles] = useState<WalletMediaFileOption[]>([]);

  const isNewItem = itemId === 'new';

  const loadDetail = useCallback(async () => {
    setLoadingDetail(true);
    setError(null);

    try {
      const mediaFilesPromise = listWalletMediaFiles();

      if (isNewItem) {
        const files = await mediaFilesPromise;
        setMediaFiles(files);
        setForm(EMPTY_FORM_STATE);
        return;
      }

      const [detail, files] = await Promise.all([
        getWalletItemDetail(itemId),
        mediaFilesPromise
      ]);

      setMediaFiles(files);

      if (!detail) {
        setError('Wallet item not found.');
        return;
      }

      setForm(detailToForm(detail));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDetail(false);
    }
  }, [isNewItem, itemId]);

  useEffect(() => {
    if (!isUnlocked) {
      return;
    }

    setSuccessMessage(null);
    void loadDetail();
  }, [isUnlocked, loadDetail]);

  const handleFieldChange = useCallback(
    (field: keyof WalletItemFormState, value: string) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const result = await saveWalletItem({
        ...(isNewItem ? {} : { id: itemId }),
        itemType: form.itemType,
        displayName: form.displayName,
        issuingAuthority: form.issuingAuthority,
        countryCode: form.countryCode,
        documentNumberLast4: form.documentNumberLast4,
        issuedOn: form.issuedOn,
        expiresOn: form.expiresOn,
        notes: form.notes,
        frontFileId: form.frontFileId || null,
        backFileId: form.backFileId || null
      });

      setSuccessMessage(
        result.created
          ? 'Wallet item created successfully.'
          : 'Wallet item updated successfully.'
      );
      onSaved?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [form, isNewItem, itemId, onSaved]);

  const handleDelete = useCallback(async () => {
    if (isNewItem) {
      return;
    }

    setDeleting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await softDeleteWalletItem(itemId);
      onDeleted?.(itemId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }, [isNewItem, itemId, onDeleted]);

  if (isLoading) {
    return (
      <div className="rounded-lg border p-6 text-center text-muted-foreground">
        Loading database...
      </div>
    );
  }

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-xl">
            {isNewItem ? 'New Wallet Item' : form.displayName || 'Wallet Item'}
          </h2>
          {!isNewItem && (
            <p className="text-muted-foreground text-sm">
              {getWalletItemTypeLabel(form.itemType)}
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
              onClick={handleDelete}
              disabled={deleting || saving}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving || deleting}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-destructive text-sm">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="rounded-lg border border-emerald-600/40 bg-emerald-600/10 p-3 text-emerald-700 text-sm dark:text-emerald-300">
          {successMessage}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="font-medium text-sm" htmlFor="wallet-item-type">
            Item Type
          </label>
          <select
            id="wallet-item-type"
            value={form.itemType}
            onChange={(event) => handleFieldChange('itemType', event.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-base shadow-sm"
          >
            {WALLET_ITEM_TYPES.map((itemType) => (
              <option key={itemType} value={itemType}>
                {getWalletItemTypeLabel(itemType)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="font-medium text-sm" htmlFor="wallet-display-name">
            Display Name
          </label>
          <Input
            id="wallet-display-name"
            value={form.displayName}
            onChange={(event) =>
              handleFieldChange('displayName', event.target.value)
            }
            placeholder="US Passport"
          />
        </div>

        <div className="space-y-2">
          <label className="font-medium text-sm" htmlFor="wallet-issuing-authority">
            Issuing Authority
          </label>
          <Input
            id="wallet-issuing-authority"
            value={form.issuingAuthority}
            onChange={(event) =>
              handleFieldChange('issuingAuthority', event.target.value)
            }
            placeholder="California DMV"
          />
        </div>

        <div className="space-y-2">
          <label className="font-medium text-sm" htmlFor="wallet-country-code">
            Country Code
          </label>
          <Input
            id="wallet-country-code"
            value={form.countryCode}
            onChange={(event) =>
              handleFieldChange('countryCode', event.target.value)
            }
            placeholder="US"
          />
        </div>

        <div className="space-y-2">
          <label className="font-medium text-sm" htmlFor="wallet-last4">
            Number (last 4)
          </label>
          <Input
            id="wallet-last4"
            value={form.documentNumberLast4}
            onChange={(event) =>
              handleFieldChange('documentNumberLast4', event.target.value)
            }
            placeholder="1234"
          />
        </div>

        <div className="space-y-2">
          <label className="font-medium text-sm" htmlFor="wallet-issued-on">
            Issued On
          </label>
          <Input
            id="wallet-issued-on"
            type="date"
            value={form.issuedOn}
            onChange={(event) => handleFieldChange('issuedOn', event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label className="font-medium text-sm" htmlFor="wallet-expires-on">
            Expires On
          </label>
          <Input
            id="wallet-expires-on"
            type="date"
            value={form.expiresOn}
            onChange={(event) =>
              handleFieldChange('expiresOn', event.target.value)
            }
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <label className="font-medium text-sm" htmlFor="wallet-notes">
            Notes
          </label>
          <Input
            id="wallet-notes"
            value={form.notes}
            onChange={(event) => handleFieldChange('notes', event.target.value)}
            placeholder="Optional notes"
          />
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <h3 className="font-medium">Card Images</h3>
        <p className="mt-1 text-muted-foreground text-sm">
          Upload files from the Files or Photos app first, then link them here.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="font-medium text-sm" htmlFor="wallet-front-file">
              Front Image
            </label>
            <select
              id="wallet-front-file"
              value={form.frontFileId}
              onChange={(event) =>
                handleFieldChange('frontFileId', event.target.value)
              }
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-base shadow-sm"
            >
              <option value="">No file linked</option>
              {mediaFiles.map((file) => (
                <option key={file.id} value={file.id}>
                  {file.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="font-medium text-sm" htmlFor="wallet-back-file">
              Back Image
            </label>
            <select
              id="wallet-back-file"
              value={form.backFileId}
              onChange={(event) => handleFieldChange('backFileId', event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-base shadow-sm"
            >
              <option value="">No file linked</option>
              {mediaFiles.map((file) => (
                <option key={file.id} value={file.id}>
                  {file.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
