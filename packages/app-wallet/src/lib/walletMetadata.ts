import {
  getWalletSubtypeDefinition,
  normalizeWalletSubtype,
  sanitizeWalletSubtypeFields
} from './walletSubtypes';
import type { WalletItemType } from './walletTypes';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface WalletMetadataShape {
  itemSubtype: string | null;
  subtypeFields: Record<string, string>;
}

const EMPTY_METADATA: WalletMetadataShape = {
  itemSubtype: null,
  subtypeFields: {}
};

function parseSubtypeFields(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const parsed: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== 'string') {
      continue;
    }
    const trimmed = rawValue.trim();
    if (trimmed.length > 0) {
      parsed[key] = trimmed;
    }
  }

  return parsed;
}

export function parseWalletMetadata(
  itemType: WalletItemType,
  rawMetadata: string | null
): WalletMetadataShape {
  if (!rawMetadata) {
    return EMPTY_METADATA;
  }

  try {
    const parsed = JSON.parse(rawMetadata);
    if (!isRecord(parsed)) {
      return EMPTY_METADATA;
    }

    const rawSubtype = parsed['itemSubtype'];
    const rawSubtypeFields = parsed['subtypeFields'];
    const subtype = normalizeWalletSubtype(
      itemType,
      typeof rawSubtype === 'string' ? rawSubtype : ''
    );
    const subtypeDefinition = subtype
      ? getWalletSubtypeDefinition(itemType, subtype)
      : null;
    const subtypeFields = sanitizeWalletSubtypeFields(
      subtypeDefinition,
      parseSubtypeFields(rawSubtypeFields)
    );

    return {
      itemSubtype: subtype,
      subtypeFields
    };
  } catch {
    return EMPTY_METADATA;
  }
}

export function buildWalletMetadata(
  itemType: WalletItemType,
  itemSubtype: string,
  subtypeFields: Record<string, string>
): string | null {
  const normalizedSubtype = normalizeWalletSubtype(itemType, itemSubtype);
  const subtypeDefinition = normalizedSubtype
    ? getWalletSubtypeDefinition(itemType, normalizedSubtype)
    : null;
  const sanitizedFields = sanitizeWalletSubtypeFields(
    subtypeDefinition,
    subtypeFields
  );

  if (!normalizedSubtype && Object.keys(sanitizedFields).length === 0) {
    return null;
  }

  const payload: Record<string, unknown> = {};
  if (normalizedSubtype) {
    payload['itemSubtype'] = normalizedSubtype;
  }
  if (Object.keys(sanitizedFields).length > 0) {
    payload['subtypeFields'] = sanitizedFields;
  }

  return JSON.stringify(payload);
}
