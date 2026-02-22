interface WalletCountryOption {
  code: string;
  name: string;
  label: string;
  searchText: string;
}

const FALLBACK_COUNTRIES: WalletCountryOption[] = [
  {
    code: 'US',
    name: 'United States',
    label: 'United States (US)',
    searchText: 'united states us'
  },
  { code: 'CA', name: 'Canada', label: 'Canada (CA)', searchText: 'canada ca' },
  { code: 'MX', name: 'Mexico', label: 'Mexico (MX)', searchText: 'mexico mx' },
  {
    code: 'GB',
    name: 'United Kingdom',
    label: 'United Kingdom (GB)',
    searchText: 'united kingdom gb uk'
  },
  {
    code: 'DE',
    name: 'Germany',
    label: 'Germany (DE)',
    searchText: 'germany de'
  },
  { code: 'FR', name: 'France', label: 'France (FR)', searchText: 'france fr' },
  { code: 'ES', name: 'Spain', label: 'Spain (ES)', searchText: 'spain es' },
  { code: 'IT', name: 'Italy', label: 'Italy (IT)', searchText: 'italy it' },
  { code: 'JP', name: 'Japan', label: 'Japan (JP)', searchText: 'japan jp' },
  {
    code: 'AU',
    name: 'Australia',
    label: 'Australia (AU)',
    searchText: 'australia au'
  }
];

function buildWalletCountryOptions(): WalletCountryOption[] {
  if (typeof Intl === 'undefined' || typeof Intl.DisplayNames !== 'function') {
    return FALLBACK_COUNTRIES;
  }

  let displayNames: Intl.DisplayNames;
  try {
    displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return FALLBACK_COUNTRIES;
  }

  const options: WalletCountryOption[] = [];
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = `${String.fromCharCode(first)}${String.fromCharCode(second)}`;
      const displayName = displayNames.of(code);
      if (!displayName) {
        continue;
      }

      const trimmedName = displayName.trim();
      if (trimmedName.length === 0) {
        continue;
      }

      // Unknown or unsupported values are echoed as their code.
      if (trimmedName.toUpperCase() === code) {
        continue;
      }

      const lowercaseName = trimmedName.toLowerCase();
      if (
        lowercaseName.includes('unknown region') ||
        lowercaseName.includes('outlying oceania')
      ) {
        continue;
      }

      options.push({
        code,
        name: trimmedName,
        label: `${trimmedName} (${code})`,
        searchText: `${lowercaseName} ${code.toLowerCase()}`
      });
    }
  }

  if (options.length === 0) {
    return FALLBACK_COUNTRIES;
  }

  options.sort((left, right) => left.name.localeCompare(right.name));
  return options;
}

const WALLET_COUNTRY_OPTIONS = buildWalletCountryOptions();
const WALLET_COUNTRY_BY_CODE = new Map<string, WalletCountryOption>();
const WALLET_COUNTRY_BY_NAME = new Map<string, WalletCountryOption>();

for (const option of WALLET_COUNTRY_OPTIONS) {
  WALLET_COUNTRY_BY_CODE.set(option.code, option);
  WALLET_COUNTRY_BY_NAME.set(option.name.toLowerCase(), option);
}

function extractCodeFromLabel(input: string): string | null {
  const match = /\(([A-Za-z]{2})\)\s*$/.exec(input);
  if (!match) {
    return null;
  }

  const code = match[1];
  if (!code) {
    return null;
  }

  return code.toUpperCase();
}

export function listWalletCountryOptions(): readonly WalletCountryOption[] {
  return WALLET_COUNTRY_OPTIONS;
}

export function getWalletCountryOptionByCode(
  countryCode: string
): WalletCountryOption | null {
  const normalizedCode = countryCode.trim().toUpperCase();
  if (normalizedCode.length !== 2) {
    return null;
  }

  return WALLET_COUNTRY_BY_CODE.get(normalizedCode) ?? null;
}

export function normalizeWalletCountryCode(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const directCode = getWalletCountryOptionByCode(trimmed);
  if (directCode) {
    return directCode.code;
  }

  const codeFromLabel = extractCodeFromLabel(trimmed);
  if (codeFromLabel) {
    const option = getWalletCountryOptionByCode(codeFromLabel);
    if (option) {
      return option.code;
    }
  }

  const optionByName = WALLET_COUNTRY_BY_NAME.get(trimmed.toLowerCase());
  if (optionByName) {
    return optionByName.code;
  }

  return null;
}

export function findWalletCountryOptions(
  query: string,
  limit = 20
): WalletCountryOption[] {
  const trimmedQuery = query.trim().toLowerCase();
  if (trimmedQuery.length === 0) {
    return WALLET_COUNTRY_OPTIONS.slice(0, limit);
  }

  const results: WalletCountryOption[] = [];
  for (const option of WALLET_COUNTRY_OPTIONS) {
    if (!option.searchText.includes(trimmedQuery)) {
      continue;
    }

    results.push(option);
    if (results.length >= limit) {
      break;
    }
  }

  return results;
}
