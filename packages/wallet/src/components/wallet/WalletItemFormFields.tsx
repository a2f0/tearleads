import { Input } from '@tearleads/ui';
import { Textarea } from '@tearleads/ui';
import { useMemo } from 'react';
import {
  getWalletCountryOptionByCode,
  listWalletCountryOptions,
  normalizeWalletCountryCode
} from '../../lib/walletCountryLookup';
import {
  getWalletItemTypeLabel,
  WALLET_ITEM_TYPES,
  type WalletItemType
} from '../../lib/walletData';
import {
  getWalletSubtypeDefinition,
  getWalletSubtypeOptions
} from '../../lib/walletSubtypes';
import { isWalletItemType } from '../../lib/walletTypes';
import {
  buildAutomaticDisplayName,
  type WalletItemFormState
} from './walletItemFormUtils';

const COUNTRY_OPTIONS = listWalletCountryOptions();

interface WalletItemFormFieldsProps {
  form: WalletItemFormState;
  customDisplayNameEnabled: boolean;
  onFieldChange: (field: keyof WalletItemFormState, value: string) => void;
  onItemTypeChange: (itemType: WalletItemType) => void;
  onSubtypeChange: (subtype: string) => void;
  onSubtypeFieldChange: (field: string, value: string) => void;
  onCustomDisplayNameEnabledChange: (enabled: boolean) => void;
}

export function WalletItemFormFields({
  form,
  customDisplayNameEnabled,
  onFieldChange,
  onItemTypeChange,
  onSubtypeChange,
  onSubtypeFieldChange,
  onCustomDisplayNameEnabledChange
}: WalletItemFormFieldsProps) {
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

  return (
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
              onItemTypeChange(value);
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
          onChange={(event) => onSubtypeChange(event.target.value)}
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
          <label className="font-medium text-sm" htmlFor="wallet-display-name">
            Display Name
          </label>
          <Input
            id="wallet-display-name"
            value={form.displayName}
            onChange={(event) =>
              onFieldChange('displayName', event.target.value)
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
                onCustomDisplayNameEnabledChange(nextEnabled);
                if (nextEnabled && form.displayName.trim().length === 0) {
                  onFieldChange('displayName', automaticDisplayName);
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
                onFieldChange('displayName', event.target.value)
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
            onFieldChange('issuingAuthority', event.target.value)
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
          onChange={(event) => onFieldChange('countryCode', event.target.value)}
          onBlur={(event) => {
            const normalized = normalizeWalletCountryCode(event.target.value);
            if (normalized) {
              onFieldChange('countryCode', normalized);
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
            onFieldChange('documentNumberLast4', event.target.value)
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
          onChange={(event) => onFieldChange('issuedOn', event.target.value)}
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
          onChange={(event) => onFieldChange('expiresOn', event.target.value)}
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
              onSubtypeFieldChange(field.key, event.target.value)
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
          onChange={(event) => onFieldChange('notes', event.target.value)}
          placeholder="Optional notes"
          className="min-h-[100px]"
        />
      </div>
    </div>
  );
}
