import { normalizeWalletCountryCode } from '../../lib/walletCountryLookup';
import {
  getWalletItemTypeLabel,
  toDateInputValue,
  type WalletItemDetailRecord,
  type WalletItemType,
  type WalletMediaSide
} from '../../lib/walletData';
import {
  getWalletSubtypeDefinition,
  getWalletSubtypeLabel
} from '../../lib/walletSubtypes';

export interface WalletItemFormState {
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

export const EMPTY_FORM_STATE: WalletItemFormState = {
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

export function detailToForm(
  detail: WalletItemDetailRecord
): WalletItemFormState {
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

export function getPickerTitle(side: WalletMediaSide | null): string {
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

export function buildAutomaticDisplayName(
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

export function retainSubtypeValues(
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

export function computeResolvedDisplayName(
  form: WalletItemFormState,
  automaticDisplayName: string,
  shouldUseCustomDisplayName: boolean
): string {
  const customName = form.displayName.trim();
  if (shouldUseCustomDisplayName) {
    return customName;
  }

  const generatedName = automaticDisplayName.trim();
  if (generatedName.length > 0) {
    return generatedName;
  }

  return getWalletItemTypeLabel(form.itemType);
}

export function determineHasCustomDisplayName(
  detailForm: WalletItemFormState,
  detailAutomaticName: string
): boolean {
  const detailCustomName = detailForm.displayName.trim();
  return (
    detailForm.itemType === 'other' ||
    (detailCustomName.length > 0 && detailCustomName !== detailAutomaticName)
  );
}
