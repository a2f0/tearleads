import { useCallback, useEffect, useMemo, useState } from 'react';
import { getWalletCountryOptionByCode } from '../../lib/walletCountryLookup';
import {
  type SaveWalletItemResult,
  type WalletItemType,
  type WalletMediaFileOption,
  type WalletMediaSide
} from '../../lib/walletData';
import { getWalletSubtypeDefinition } from '../../lib/walletSubtypes';
import { useWalletRuntime } from '../../runtime';
import { useWalletItemActions } from './useWalletItemActions';
import { useWalletTracker } from './useWalletTracker';
import { WalletItemAlerts } from './WalletItemAlerts';
import { WalletItemFormFields } from './WalletItemFormFields';
import { WalletItemHeader } from './WalletItemHeader';
import { WalletItemLoadingStates } from './WalletItemLoadingStates';
import { WalletItemMediaSection } from './WalletItemMediaSection';
import {
  buildAutomaticDisplayName,
  computeResolvedDisplayName,
  detailToForm,
  determineHasCustomDisplayName,
  EMPTY_FORM_STATE,
  retainSubtypeValues,
  type WalletItemFormState
} from './walletItemFormUtils';

interface WalletItemDetailProps {
  itemId: string;
  initialItemType?: WalletItemType;
  onSaved?: (result: SaveWalletItemResult) => void;
  onDeleted?: (itemId: string) => void;
  onCreateItem?: () => void;
}

export function WalletItemDetail({
  itemId,
  initialItemType,
  onSaved,
  onDeleted,
  onCreateItem
}: WalletItemDetailProps) {
  const { isUnlocked } = useWalletRuntime();
  const tracker = useWalletTracker();
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [form, setForm] = useState<WalletItemFormState>(EMPTY_FORM_STATE);
  const [mediaFiles, setMediaFiles] = useState<WalletMediaFileOption[]>([]);
  const [pickerSide, setPickerSide] = useState<WalletMediaSide | null>(null);
  const [customDisplayNameEnabled, setCustomDisplayNameEnabled] =
    useState(false);

  const isNewItem = itemId === 'new';

  const countrySelection = useMemo(
    () => getWalletCountryOptionByCode(form.countryCode),
    [form.countryCode]
  );
  const automaticDisplayName = useMemo(
    () => buildAutomaticDisplayName(form, countrySelection?.name ?? null),
    [countrySelection?.name, form]
  );
  const isOtherType = form.itemType === 'other';
  const shouldUseCustomDisplayName = isOtherType || customDisplayNameEnabled;
  const resolvedDisplayName = useMemo(
    () =>
      computeResolvedDisplayName(
        form,
        automaticDisplayName,
        shouldUseCustomDisplayName
      ),
    [automaticDisplayName, form, shouldUseCustomDisplayName]
  );

  const {
    saving,
    deleting,
    error,
    successMessage,
    setError,
    setSuccessMessage,
    handleSave,
    handleDelete
  } = useWalletItemActions({
    itemId,
    isNewItem,
    form,
    resolvedDisplayName,
    onSaved,
    onDeleted
  });

  const loadDetail = useCallback(async () => {
    if (!tracker) return;
    setLoadingDetail(true);
    setError(null);

    try {
      const mediaFilesPromise = tracker.listMediaFiles();

      if (isNewItem) {
        const fetchedFiles = await mediaFilesPromise;
        setMediaFiles(fetchedFiles);
        setForm({
          ...EMPTY_FORM_STATE,
          itemType: initialItemType ?? EMPTY_FORM_STATE.itemType
        });
        setCustomDisplayNameEnabled(false);
        return;
      }

      const [detail, fetchedFiles] = await Promise.all([
        tracker.getItemDetail(itemId),
        mediaFilesPromise
      ]);

      setMediaFiles(fetchedFiles);

      if (!detail) {
        setError('Wallet item not found.');
        return;
      }

      const detailForm = detailToForm(detail);
      const detailAutomaticName = buildAutomaticDisplayName(
        detailForm,
        getWalletCountryOptionByCode(detailForm.countryCode)?.name ?? null
      );
      const hasCustomDisplayName = determineHasCustomDisplayName(
        detailForm,
        detailAutomaticName
      );

      setForm(detailForm);
      setCustomDisplayNameEnabled(hasCustomDisplayName);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDetail(false);
    }
  }, [initialItemType, isNewItem, itemId, setError, tracker]);

  useEffect(() => {
    if (!isUnlocked) {
      return;
    }
    setSuccessMessage(null);
    void loadDetail();
  }, [isUnlocked, loadDetail, setSuccessMessage]);

  const handleFieldChange = useCallback(
    (field: keyof WalletItemFormState, value: string) => {
      setForm((previous) => ({ ...previous, [field]: value }));
    },
    []
  );

  const handleItemTypeChange = useCallback((nextItemType: WalletItemType) => {
    setCustomDisplayNameEnabled(nextItemType === 'other');
    setForm((previous) => {
      const subtypeStillValid = getWalletSubtypeDefinition(
        nextItemType,
        previous.itemSubtype
      );
      const nextSubtype = subtypeStillValid ? previous.itemSubtype : '';
      return {
        ...previous,
        itemType: nextItemType,
        itemSubtype: nextSubtype,
        subtypeFields: retainSubtypeValues(
          nextItemType,
          nextSubtype,
          previous.subtypeFields
        )
      };
    });
  }, []);

  const handleSubtypeChange = useCallback((nextSubtype: string) => {
    setForm((previous) => ({
      ...previous,
      itemSubtype: nextSubtype,
      subtypeFields: retainSubtypeValues(
        previous.itemType,
        nextSubtype,
        previous.subtypeFields
      )
    }));
  }, []);

  const handleSubtypeFieldChange = useCallback(
    (field: string, value: string) => {
      setForm((previous) => ({
        ...previous,
        subtypeFields: { ...previous.subtypeFields, [field]: value }
      }));
    },
    []
  );

  const openPickerForSide = useCallback((side: WalletMediaSide) => {
    setPickerSide(side);
  }, []);

  const clearMediaSide = useCallback(
    (side: WalletMediaSide) => {
      handleFieldChange(side === 'front' ? 'frontFileId' : 'backFileId', '');
    },
    [handleFieldChange]
  );

  const handleSelectMedia = useCallback(
    (fileId: string) => {
      if (!pickerSide) return;
      handleFieldChange(
        pickerSide === 'front' ? 'frontFileId' : 'backFileId',
        fileId
      );
      setPickerSide(null);
    },
    [handleFieldChange, pickerSide]
  );

  if (!isUnlocked || loadingDetail) {
    return (
      <WalletItemLoadingStates
        isUnlocked={isUnlocked}
        loadingDetail={loadingDetail}
      />
    );
  }

  return (
    <div className="space-y-6">
      <WalletItemHeader
        isNewItem={isNewItem}
        resolvedDisplayName={resolvedDisplayName}
        itemType={form.itemType}
        saving={saving}
        deleting={deleting}
        onSave={handleSave}
        onDelete={handleDelete}
        onCreateItem={onCreateItem}
      />
      <WalletItemAlerts error={error} successMessage={successMessage} />
      <WalletItemFormFields
        form={form}
        customDisplayNameEnabled={customDisplayNameEnabled}
        onFieldChange={handleFieldChange}
        onItemTypeChange={handleItemTypeChange}
        onSubtypeChange={handleSubtypeChange}
        onSubtypeFieldChange={handleSubtypeFieldChange}
        onCustomDisplayNameEnabledChange={setCustomDisplayNameEnabled}
      />
      <WalletItemMediaSection
        frontFileId={form.frontFileId}
        backFileId={form.backFileId}
        mediaFiles={mediaFiles}
        pickerSide={pickerSide}
        onOpenPicker={openPickerForSide}
        onClearMedia={clearMediaSide}
        onSelectMedia={handleSelectMedia}
        onPickerClose={() => setPickerSide(null)}
      />
    </div>
  );
}
