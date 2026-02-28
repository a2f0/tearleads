import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { WalletItemType, WalletMediaSide } from '../../lib/walletData';
import { getWalletSubtypeDefinition } from '../../lib/walletSubtypes';
import {
  retainSubtypeValues,
  type WalletItemFormState
} from './walletItemFormUtils';

interface UseWalletItemDetailFormParams {
  pickerSide: WalletMediaSide | null;
  setForm: Dispatch<SetStateAction<WalletItemFormState>>;
  setCustomDisplayNameEnabled: Dispatch<SetStateAction<boolean>>;
  setPickerSide: Dispatch<SetStateAction<WalletMediaSide | null>>;
}

export function useWalletItemDetailForm({
  pickerSide,
  setForm,
  setCustomDisplayNameEnabled,
  setPickerSide
}: UseWalletItemDetailFormParams) {
  const handleFieldChange = useCallback(
    (field: keyof WalletItemFormState, value: string) => {
      setForm((previous) => ({ ...previous, [field]: value }));
    },
    [setForm]
  );

  const handleItemTypeChange = useCallback(
    (nextItemType: WalletItemType) => {
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
    },
    [setCustomDisplayNameEnabled, setForm]
  );

  const handleSubtypeChange = useCallback(
    (nextSubtype: string) => {
      setForm((previous) => ({
        ...previous,
        itemSubtype: nextSubtype,
        subtypeFields: retainSubtypeValues(
          previous.itemType,
          nextSubtype,
          previous.subtypeFields
        )
      }));
    },
    [setForm]
  );

  const handleSubtypeFieldChange = useCallback(
    (field: string, value: string) => {
      setForm((previous) => ({
        ...previous,
        subtypeFields: { ...previous.subtypeFields, [field]: value }
      }));
    },
    [setForm]
  );

  const openPickerForSide = useCallback(
    (side: WalletMediaSide) => {
      setPickerSide(side);
    },
    [setPickerSide]
  );

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
    [handleFieldChange, pickerSide, setPickerSide]
  );

  return {
    handleFieldChange,
    handleItemTypeChange,
    handleSubtypeChange,
    handleSubtypeFieldChange,
    openPickerForSide,
    clearMediaSide,
    handleSelectMedia
  };
}
