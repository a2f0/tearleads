import { InlineUnlock } from '@client/components/sqlite/InlineUnlock';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Textarea } from '@client/components/ui/textarea';
import { useDatabaseContext } from '@client/db/hooks';
import { Loader2, Plus, Save, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getWalletCountryOptionByCode,
  listWalletCountryOptions,
  normalizeWalletCountryCode
} from '../../lib/walletCountryLookup';
import {
  getWalletItemDetail,
  getWalletItemTypeLabel,
  listWalletMediaFiles,
  type SaveWalletItemResult,
  saveWalletItem,
  softDeleteWalletItem,
  toDateInputValue,
  WALLET_ITEM_TYPES,
  type WalletItemDetailRecord,
  type WalletItemType,
  type WalletMediaFileOption,
  type WalletMediaSide
} from '../../lib/walletData';
import {
  getWalletSubtypeDefinition,
  getWalletSubtypeLabel,
  getWalletSubtypeOptions
} from '../../lib/walletSubtypes';
import { isWalletItemType } from '../../lib/walletTypes';
import { WalletMediaPickerModal } from './WalletMediaPickerModal';

interface WalletItemDetailProps {
  itemId: string;
  initialItemType?: WalletItemType;
  onSaved?: (result: SaveWalletItemResult) => void;
  onDeleted?: (itemId: string) => void;
  onCreateItem?: () => void;
}

interface WalletItemFormState {
  itemType: WalletItemType;
  itemSubtype: string;
  subtypeFields: Record<string, string>;
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
  itemSubtype: '',
  subtypeFields: {},
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

const COUNTRY_OPTIONS = listWalletCountryOptions();

function detailToForm(detail: WalletItemDetailRecord): WalletItemFormState {
  return {
    itemType: detail.itemType,
    itemSubtype: detail.itemSubtype ?? '',
    subtypeFields: detail.subtypeFields,
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

function getPickerTitle(side: WalletMediaSide | null): string {
  if (side === 'front') {
    return 'Select Front Image';
  }
  return 'Select Back Image';
}

function joinDisplayNameParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part ? part.trim() : ''))
    .filter((part) => part.length > 0)
    .join(' ');
}

function resolveCountryDisplayText(
  countryCodeInput: string,
  countryName: string | null
): string | null {
  const trimmedName = countryName?.trim();
  if (trimmedName && trimmedName.length > 0) {
    return trimmedName;
  }

  const normalizedCode = normalizeWalletCountryCode(countryCodeInput);
  return normalizedCode;
}

function getCardLast4Label(last4Input: string): string | null {
  const compact = last4Input.trim().replace(/\s+/g, '');
  if (compact.length === 0) {
    return null;
  }
  return `•••• ${compact.slice(-4)}`;
}

function buildAutomaticDisplayName(
  form: WalletItemFormState,
  countryName: string | null
): string {
  const subtypeLabel = getWalletSubtypeLabel(form.itemType, form.itemSubtype);
  const countryText = resolveCountryDisplayText(form.countryCode, countryName);
  const authorityText = form.issuingAuthority.trim();
  const providerName = form.subtypeFields['providerName']?.trim() ?? '';
  const last4Label = getCardLast4Label(form.documentNumberLast4);

  switch (form.itemType) {
    case 'passport':
      return joinDisplayNameParts([countryText, subtypeLabel, 'Passport']);
    case 'driverLicense':
      return joinDisplayNameParts([
        authorityText || countryText,
        subtypeLabel,
        'Driver License'
      ]);
    case 'birthCertificate':
      return joinDisplayNameParts([
        countryText,
        subtypeLabel,
        'Birth Certificate'
      ]);
    case 'creditCard':
      return joinDisplayNameParts([
        authorityText,
        subtypeLabel,
        'Credit Card',
        last4Label
      ]);
    case 'debitCard':
      return joinDisplayNameParts([
        authorityText,
        subtypeLabel,
        'Debit Card',
        last4Label
      ]);
    case 'identityCard':
      return joinDisplayNameParts([
        authorityText || countryText,
        subtypeLabel,
        'Identity Card'
      ]);
    case 'insuranceCard':
      return joinDisplayNameParts([
        providerName,
        subtypeLabel ?? 'Insurance Card'
      ]);
    case 'other':
      return '';
    default:
      return '';
  }
}

function retainSubtypeValues(
  itemType: WalletItemType,
  itemSubtype: string,
  values: Record<string, string>
): Record<string, string> {
  const definition = getWalletSubtypeDefinition(itemType, itemSubtype);
  if (!definition) {
    return {};
  }

  const retained: Record<string, string> = {};
  for (const field of definition.fields) {
    const rawValue = values[field.key];
    if (typeof rawValue === 'string') {
      retained[field.key] = rawValue;
    }
  }

  return retained;
}

export function WalletItemDetail({
  itemId,
  initialItemType,
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
  const [pickerSide, setPickerSide] = useState<WalletMediaSide | null>(null);
  const [customDisplayNameEnabled, setCustomDisplayNameEnabled] =
    useState(false);

  const isNewItem = itemId === 'new';

  const activeSubtypeDefinition = useMemo(
    () => getWalletSubtypeDefinition(form.itemType, form.itemSubtype),
    [form.itemType, form.itemSubtype]
  );
  const subtypeOptions = useMemo(
    () => getWalletSubtypeOptions(form.itemType),
    [form.itemType]
  );
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
  const resolvedDisplayName = useMemo(() => {
    const customName = form.displayName.trim();
    if (shouldUseCustomDisplayName) {
      return customName;
    }

    const generatedName = automaticDisplayName.trim();
    if (generatedName.length > 0) {
      return generatedName;
    }

    return getWalletItemTypeLabel(form.itemType);
  }, [
    automaticDisplayName,
    form.displayName,
    form.itemType,
    shouldUseCustomDisplayName
  ]);
  const frontMedia = useMemo(
    () => mediaFiles.find((file) => file.id === form.frontFileId) ?? null,
    [mediaFiles, form.frontFileId]
  );
  const backMedia = useMemo(
    () => mediaFiles.find((file) => file.id === form.backFileId) ?? null,
    [mediaFiles, form.backFileId]
  );

  const loadDetail = useCallback(async () => {
    setLoadingDetail(true);
    setError(null);

    try {
      const mediaFilesPromise = listWalletMediaFiles();

      if (isNewItem) {
        const files = await mediaFilesPromise;
        setMediaFiles(files);
        setForm({
          ...EMPTY_FORM_STATE,
          itemType: initialItemType ?? EMPTY_FORM_STATE.itemType
        });
        setCustomDisplayNameEnabled(false);
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

      const detailForm = detailToForm(detail);
      const detailAutomaticName = buildAutomaticDisplayName(
        detailForm,
        getWalletCountryOptionByCode(detailForm.countryCode)?.name ?? null
      );
      const detailCustomName = detailForm.displayName.trim();
      const hasCustomDisplayName =
        detailForm.itemType === 'other' ||
        (detailCustomName.length > 0 &&
          detailCustomName !== detailAutomaticName);

      setForm(detailForm);
      setCustomDisplayNameEnabled(hasCustomDisplayName);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDetail(false);
    }
  }, [initialItemType, isNewItem, itemId]);

  useEffect(() => {
    if (!isUnlocked) {
      return;
    }

    setSuccessMessage(null);
    void loadDetail();
  }, [isUnlocked, loadDetail]);

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
        subtypeFields: {
          ...previous.subtypeFields,
          [field]: value
        }
      }));
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
  }, [form, isNewItem, itemId, onSaved, resolvedDisplayName]);

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

  const openPickerForSide = useCallback((side: WalletMediaSide) => {
    setPickerSide(side);
  }, []);

  const clearMediaSide = useCallback(
    (side: WalletMediaSide) => {
      if (side === 'front') {
        handleFieldChange('frontFileId', '');
        return;
      }
      handleFieldChange('backFileId', '');
    },
    [handleFieldChange]
  );

  const handleSelectMedia = useCallback(
    (fileId: string) => {
      if (!pickerSide) {
        return;
      }
      if (pickerSide === 'front') {
        handleFieldChange('frontFileId', fileId);
      } else {
        handleFieldChange('backFileId', fileId);
      }
      setPickerSide(null);
    },
    [handleFieldChange, pickerSide]
  );

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
            {isNewItem
              ? 'New Wallet Item'
              : resolvedDisplayName || 'Wallet Item'}
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
            onChange={(event) => {
              const value = event.target.value;
              if (isWalletItemType(value)) {
                handleItemTypeChange(value);
              }
            }}
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
          <label className="font-medium text-sm" htmlFor="wallet-item-subtype">
            Subtype
          </label>
          <select
            id="wallet-item-subtype"
            value={form.itemSubtype}
            onChange={(event) => handleSubtypeChange(event.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-base shadow-sm"
          >
            <option value="">No subtype</option>
            {subtypeOptions.map((subtype) => (
              <option key={subtype.id} value={subtype.id}>
                {subtype.label}
              </option>
            ))}
          </select>
          {activeSubtypeDefinition && (
            <p className="text-muted-foreground text-xs">
              {activeSubtypeDefinition.description}
            </p>
          )}
        </div>

        {isOtherType ? (
          <div className="space-y-2">
            <label
              className="font-medium text-sm"
              htmlFor="wallet-display-name"
            >
              Display Name
            </label>
            <Input
              id="wallet-display-name"
              value={form.displayName}
              onChange={(event) =>
                handleFieldChange('displayName', event.target.value)
              }
              placeholder="Custom Wallet Item"
            />
          </div>
        ) : (
          <div className="space-y-2 md:col-span-2">
            <p className="font-medium text-sm">Display Name</p>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              {automaticDisplayName || getWalletItemTypeLabel(form.itemType)}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={customDisplayNameEnabled}
                onChange={(event) => {
                  const nextEnabled = event.target.checked;
                  setCustomDisplayNameEnabled(nextEnabled);
                  if (nextEnabled && form.displayName.trim().length === 0) {
                    handleFieldChange('displayName', automaticDisplayName);
                  }
                }}
              />
              Use custom display name
            </label>
            {customDisplayNameEnabled && (
              <Input
                id="wallet-display-name"
                value={form.displayName}
                onChange={(event) =>
                  handleFieldChange('displayName', event.target.value)
                }
                placeholder={
                  automaticDisplayName || getWalletItemTypeLabel(form.itemType)
                }
              />
            )}
          </div>
        )}

        <div className="space-y-2">
          <label
            className="font-medium text-sm"
            htmlFor="wallet-issuing-authority"
          >
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
            onBlur={(event) => {
              const normalized = normalizeWalletCountryCode(event.target.value);
              if (normalized) {
                handleFieldChange('countryCode', normalized);
              }
            }}
            list="wallet-country-code-options"
            placeholder="Type country (e.g., United States or US)"
          />
          <datalist id="wallet-country-code-options">
            {COUNTRY_OPTIONS.map((country) => (
              <option key={country.code} value={country.label} />
            ))}
          </datalist>
          {form.countryCode.trim().length > 0 && (
            <p className="text-muted-foreground text-xs">
              {countrySelection
                ? `${countrySelection.name} (${countrySelection.code})`
                : 'Country code not recognized. Use a valid ISO country value.'}
            </p>
          )}
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
            onChange={(event) =>
              handleFieldChange('issuedOn', event.target.value)
            }
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

        {activeSubtypeDefinition?.fields.map((field) => (
          <div key={field.key} className="space-y-2">
            <label
              className="font-medium text-sm"
              htmlFor={`wallet-subtype-${field.key}`}
            >
              {field.label}
            </label>
            <Input
              id={`wallet-subtype-${field.key}`}
              value={form.subtypeFields[field.key] ?? ''}
              onChange={(event) =>
                handleSubtypeFieldChange(field.key, event.target.value)
              }
              placeholder={field.placeholder}
            />
          </div>
        ))}

        <div className="space-y-2 md:col-span-2">
          <label className="font-medium text-sm" htmlFor="wallet-notes">
            Notes
          </label>
          <Textarea
            id="wallet-notes"
            value={form.notes}
            onChange={(event) => handleFieldChange('notes', event.target.value)}
            placeholder="Optional notes"
            className="min-h-[100px]"
          />
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <h3 className="font-medium">Card Images</h3>
        <p className="mt-1 text-muted-foreground text-sm">
          Search and attach front/back images visually from thumbnails.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-3">
            <p className="font-medium text-sm">Front Image</p>
            <p className="mt-1 truncate text-muted-foreground text-xs">
              {frontMedia ? frontMedia.name : 'No image linked'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openPickerForSide('front')}
              >
                <Search className="mr-1 h-3 w-3" />
                Browse Images
              </Button>
              {form.frontFileId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => clearMediaSide('front')}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <p className="font-medium text-sm">Back Image</p>
            <p className="mt-1 truncate text-muted-foreground text-xs">
              {backMedia ? backMedia.name : 'No image linked'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openPickerForSide('back')}
              >
                <Search className="mr-1 h-3 w-3" />
                Browse Images
              </Button>
              {form.backFileId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => clearMediaSide('back')}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <WalletMediaPickerModal
        open={pickerSide !== null}
        title={getPickerTitle(pickerSide)}
        files={mediaFiles}
        selectedFileId={
          pickerSide === 'front'
            ? form.frontFileId
            : pickerSide === 'back'
              ? form.backFileId
              : ''
        }
        onOpenChange={(open) => {
          if (!open) {
            setPickerSide(null);
          }
        }}
        onSelectFile={handleSelectMedia}
      />
    </div>
  );
}
