export const DUNS_DIGIT_COUNT = 9;
export const EIN_DIGIT_COUNT = 9;

const INVALID_IDENTIFIER_CHARACTER_REGEX = /[^\d\s-]/;
const NON_DIGIT_REGEX = /\D/g;
const ALL_ZEROES_REGEX = /^0+$/;

type IdentifierValidationSuccess = {
  ok: true;
  value: string;
};

type IdentifierValidationFailure = {
  ok: false;
  error: string;
};

export type IdentifierValidationResult =
  | IdentifierValidationSuccess
  | IdentifierValidationFailure;

export type BusinessIdentifierField = 'dunsNumber' | 'ein';

export interface BusinessIdentifiers {
  dunsNumber?: string;
  ein?: string;
}

export interface BusinessIdentifiersInput {
  dunsNumber?: string | null;
  ein?: string | null;
}

export interface BusinessIdentifierError {
  field: BusinessIdentifierField;
  error: string;
}

type BusinessIdentifiersValidationSuccess = {
  ok: true;
  value: BusinessIdentifiers;
};

type BusinessIdentifiersValidationFailure = {
  ok: false;
  errors: BusinessIdentifierError[];
};

export type BusinessIdentifiersValidationResult =
  | BusinessIdentifiersValidationSuccess
  | BusinessIdentifiersValidationFailure;

const containsOnlySupportedIdentifierCharacters = (value: string): boolean =>
  !INVALID_IDENTIFIER_CHARACTER_REGEX.test(value);

const stripIdentifierSeparators = (value: string): string =>
  value.replace(NON_DIGIT_REGEX, '');

const hasMeaningfulText = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const validateDunsNumber = (
  value: string
): IdentifierValidationResult => {
  if (value.trim().length === 0) {
    return { ok: false, error: 'DUNS number is required' };
  }

  if (!containsOnlySupportedIdentifierCharacters(value)) {
    return {
      ok: false,
      error: 'DUNS number can only contain digits, spaces, and hyphens'
    };
  }

  const normalized = stripIdentifierSeparators(value);
  if (normalized.length !== DUNS_DIGIT_COUNT) {
    return {
      ok: false,
      error: `DUNS number must contain exactly ${DUNS_DIGIT_COUNT} digits`
    };
  }

  if (ALL_ZEROES_REGEX.test(normalized)) {
    return { ok: false, error: 'DUNS number cannot be all zeros' };
  }

  return { ok: true, value: normalized };
};

export const normalizeDunsNumber = (value: string): string | null => {
  const result = validateDunsNumber(value);
  return result.ok ? result.value : null;
};

export const formatDunsNumber = (value: string): string | null => {
  const normalized = normalizeDunsNumber(value);
  if (normalized === null) {
    return null;
  }

  return `${normalized.slice(0, 2)}-${normalized.slice(2, 5)}-${normalized.slice(5)}`;
};

export const isDunsNumber = (value: string): boolean =>
  validateDunsNumber(value).ok;

export const validateEin = (value: string): IdentifierValidationResult => {
  if (value.trim().length === 0) {
    return { ok: false, error: 'EIN is required' };
  }

  if (!containsOnlySupportedIdentifierCharacters(value)) {
    return {
      ok: false,
      error: 'EIN can only contain digits, spaces, and hyphens'
    };
  }

  const normalized = stripIdentifierSeparators(value);
  if (normalized.length !== EIN_DIGIT_COUNT) {
    return {
      ok: false,
      error: `EIN must contain exactly ${EIN_DIGIT_COUNT} digits`
    };
  }

  const prefix = normalized.slice(0, 2);
  const suffix = normalized.slice(2);
  if (prefix === '00') {
    return { ok: false, error: 'EIN prefix cannot be 00' };
  }
  if (ALL_ZEROES_REGEX.test(suffix)) {
    return { ok: false, error: 'EIN suffix cannot be all zeros' };
  }

  return { ok: true, value: normalized };
};

export const normalizeEin = (value: string): string | null => {
  const result = validateEin(value);
  return result.ok ? result.value : null;
};

export const formatEin = (value: string): string | null => {
  const normalized = normalizeEin(value);
  if (normalized === null) {
    return null;
  }

  return `${normalized.slice(0, 2)}-${normalized.slice(2)}`;
};

export const isEin = (value: string): boolean => validateEin(value).ok;

export const normalizeBusinessIdentifiers = (
  input: BusinessIdentifiersInput
): BusinessIdentifiersValidationResult => {
  const value: BusinessIdentifiers = {};
  const errors: BusinessIdentifierError[] = [];

  if (hasMeaningfulText(input.dunsNumber)) {
    const dunsResult = validateDunsNumber(input.dunsNumber);
    if (dunsResult.ok) {
      value.dunsNumber = dunsResult.value;
    } else {
      errors.push({ field: 'dunsNumber', error: dunsResult.error });
    }
  }

  if (hasMeaningfulText(input.ein)) {
    const einResult = validateEin(input.ein);
    if (einResult.ok) {
      value.ein = einResult.value;
    } else {
      errors.push({ field: 'ein', error: einResult.error });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value };
};
