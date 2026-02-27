import { useCallback, useState } from 'react';
import type { SaveWalletItemResult } from '../../lib/walletData';
import type { WalletItemFormState } from './walletItemFormUtils';
import { useWalletTracker } from './useWalletTracker';

interface UseWalletItemActionsProps {
  itemId: string;
  isNewItem: boolean;
  form: WalletItemFormState;
  resolvedDisplayName: string;
  onSaved?: ((result: SaveWalletItemResult) => void) | undefined;
  onDeleted?: ((itemId: string) => void) | undefined;
}

interface UseWalletItemActionsResult {
  saving: boolean;
  deleting: boolean;
  error: string | null;
  successMessage: string | null;
  setError: (error: string | null) => void;
  setSuccessMessage: (message: string | null) => void;
  handleSave: () => Promise<void>;
  handleDelete: () => Promise<void>;
}

export function useWalletItemActions({
  itemId,
  isNewItem,
  form,
  resolvedDisplayName,
  onSaved,
  onDeleted
}: UseWalletItemActionsProps): UseWalletItemActionsResult {
  const tracker = useWalletTracker();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!tracker) return;
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const result = await tracker.saveItem({
        ...(isNewItem ? {} : { id: itemId }),
        itemType: form.itemType,
        itemSubtype: form.itemSubtype,
        subtypeFields: form.subtypeFields,
        displayName: resolvedDisplayName,
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
  }, [form, isNewItem, itemId, onSaved, resolvedDisplayName, tracker]);

  const handleDelete = useCallback(async () => {
    if (isNewItem || !tracker) {
      return;
    }

    setDeleting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await tracker.softDeleteItem(itemId);
      onDeleted?.(itemId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }, [isNewItem, itemId, onDeleted, tracker]);

  return {
    saving,
    deleting,
    error,
    successMessage,
    setError,
    setSuccessMessage,
    handleSave,
    handleDelete
  };
}
