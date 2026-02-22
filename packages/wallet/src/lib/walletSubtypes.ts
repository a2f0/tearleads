import type { WalletItemType } from './walletTypes';

interface WalletSubtypeFieldDefinition {
  key: string;
  label: string;
  placeholder: string;
}

interface WalletSubtypeDefinition {
  id: string;
  label: string;
  description: string;
  fields: readonly WalletSubtypeFieldDefinition[];
}

const EMPTY_FIELDS: readonly WalletSubtypeFieldDefinition[] = [];

const WALLET_SUBTYPE_OPTIONS: Record<
  WalletItemType,
  readonly WalletSubtypeDefinition[]
> = {
  passport: [
    {
      id: 'book',
      label: 'Book',
      description: 'Standard passport booklet used for international travel.',
      fields: EMPTY_FIELDS
    },
    {
      id: 'card',
      label: 'Card',
      description: 'Passport card format for limited border crossings.',
      fields: EMPTY_FIELDS
    },
    {
      id: 'diplomatic',
      label: 'Diplomatic',
      description: 'Diplomatic or official passport variant.',
      fields: EMPTY_FIELDS
    }
  ],
  driverLicense: [
    {
      id: 'standard',
      label: 'Standard',
      description: 'Regular state-issued driver license.',
      fields: EMPTY_FIELDS
    },
    {
      id: 'realId',
      label: 'REAL ID',
      description: 'REAL ID compliant credential.',
      fields: EMPTY_FIELDS
    },
    {
      id: 'commercial',
      label: 'Commercial',
      description: 'Commercial driver license (CDL).',
      fields: EMPTY_FIELDS
    },
    {
      id: 'permit',
      label: 'Permit',
      description: 'Learner or provisional permit.',
      fields: EMPTY_FIELDS
    }
  ],
  birthCertificate: [
    {
      id: 'certifiedCopy',
      label: 'Certified Copy',
      description: 'Official certified birth certificate.',
      fields: EMPTY_FIELDS
    },
    {
      id: 'shortForm',
      label: 'Short Form',
      description: 'Abbreviated extract version.',
      fields: EMPTY_FIELDS
    },
    {
      id: 'longForm',
      label: 'Long Form',
      description: 'Full long-form certificate with detailed data.',
      fields: EMPTY_FIELDS
    }
  ],
  creditCard: [
    {
      id: 'personal',
      label: 'Personal',
      description: 'Consumer credit card.',
      fields: EMPTY_FIELDS
    },
    {
      id: 'business',
      label: 'Business',
      description: 'Business credit card account.',
      fields: EMPTY_FIELDS
    },
    {
      id: 'secured',
      label: 'Secured',
      description: 'Secured credit card backed by deposit.',
      fields: EMPTY_FIELDS
    }
  ],
  debitCard: [
    {
      id: 'checking',
      label: 'Checking',
      description: 'Debit card linked to checking account.',
      fields: EMPTY_FIELDS
    },
    {
      id: 'savings',
      label: 'Savings',
      description: 'Debit card linked to savings account.',
      fields: EMPTY_FIELDS
    },
    {
      id: 'prepaid',
      label: 'Prepaid',
      description: 'Prepaid debit account.',
      fields: EMPTY_FIELDS
    }
  ],
  identityCard: [
    {
      id: 'stateId',
      label: 'State ID',
      description: 'State or province non-driver identification card.',
      fields: EMPTY_FIELDS
    },
    {
      id: 'nationalId',
      label: 'National ID',
      description: 'National government identity card.',
      fields: EMPTY_FIELDS
    },
    {
      id: 'militaryId',
      label: 'Military ID',
      description: 'Military identification card.',
      fields: EMPTY_FIELDS
    }
  ],
  insuranceCard: [
    {
      id: 'health',
      label: 'Health Insurance',
      description: 'Medical coverage card.',
      fields: [
        {
          key: 'providerName',
          label: 'Provider',
          placeholder: 'Blue Cross Blue Shield'
        },
        {
          key: 'memberId',
          label: 'Member ID',
          placeholder: 'ABC123456'
        },
        {
          key: 'groupNumber',
          label: 'Group Number',
          placeholder: 'G-12345'
        },
        {
          key: 'policyNumber',
          label: 'Policy Number',
          placeholder: 'P-987654'
        },
        { key: 'planName', label: 'Plan Name', placeholder: 'Gold PPO' }
      ]
    },
    {
      id: 'dental',
      label: 'Dental Insurance',
      description: 'Dental coverage card.',
      fields: [
        {
          key: 'providerName',
          label: 'Provider',
          placeholder: 'Delta Dental'
        },
        {
          key: 'memberId',
          label: 'Member ID',
          placeholder: 'DNT-123456'
        },
        {
          key: 'groupNumber',
          label: 'Group Number',
          placeholder: 'G-12345'
        },
        {
          key: 'policyNumber',
          label: 'Policy Number',
          placeholder: 'P-987654'
        }
      ]
    },
    {
      id: 'vision',
      label: 'Vision Insurance',
      description: 'Vision coverage card.',
      fields: [
        {
          key: 'providerName',
          label: 'Provider',
          placeholder: 'VSP'
        },
        {
          key: 'memberId',
          label: 'Member ID',
          placeholder: 'VIS-123456'
        },
        {
          key: 'groupNumber',
          label: 'Group Number',
          placeholder: 'G-12345'
        },
        {
          key: 'policyNumber',
          label: 'Policy Number',
          placeholder: 'P-987654'
        }
      ]
    },
    {
      id: 'pharmacy',
      label: 'Pharmacy Benefit',
      description: 'Prescription benefit card.',
      fields: [
        {
          key: 'providerName',
          label: 'Provider',
          placeholder: 'Express Scripts'
        },
        {
          key: 'memberId',
          label: 'Member ID',
          placeholder: 'RX-123456'
        },
        {
          key: 'groupNumber',
          label: 'Group Number',
          placeholder: 'G-12345'
        },
        { key: 'rxBin', label: 'Rx BIN', placeholder: '012345' },
        { key: 'rxPcn', label: 'Rx PCN', placeholder: 'PCN123' }
      ]
    },
    {
      id: 'auto',
      label: 'Auto Insurance',
      description: 'Auto policy card.',
      fields: [
        {
          key: 'providerName',
          label: 'Provider',
          placeholder: 'GEICO'
        },
        {
          key: 'policyNumber',
          label: 'Policy Number',
          placeholder: 'AUTO-123456'
        }
      ]
    },
    {
      id: 'otherInsurance',
      label: 'Other Insurance',
      description: 'Other policy card type.',
      fields: [
        {
          key: 'providerName',
          label: 'Provider',
          placeholder: 'Insurance Provider'
        },
        {
          key: 'policyNumber',
          label: 'Policy Number',
          placeholder: 'POL-123456'
        }
      ]
    }
  ],
  other: [
    {
      id: 'general',
      label: 'General',
      description: 'Custom wallet item.',
      fields: EMPTY_FIELDS
    }
  ]
};

export function getWalletSubtypeOptions(
  itemType: WalletItemType
): readonly WalletSubtypeDefinition[] {
  return WALLET_SUBTYPE_OPTIONS[itemType];
}

export function getWalletSubtypeDefinition(
  itemType: WalletItemType,
  subtypeId: string
): WalletSubtypeDefinition | null {
  const normalizedSubtypeId = subtypeId.trim();
  if (normalizedSubtypeId.length === 0) {
    return null;
  }

  const options = getWalletSubtypeOptions(itemType);
  for (const option of options) {
    if (option.id === normalizedSubtypeId) {
      return option;
    }
  }

  return null;
}

export function getWalletSubtypeLabel(
  itemType: WalletItemType,
  subtypeId: string | null
): string | null {
  if (!subtypeId) {
    return null;
  }
  const definition = getWalletSubtypeDefinition(itemType, subtypeId);
  return definition ? definition.label : null;
}

export function normalizeWalletSubtype(
  itemType: WalletItemType,
  subtypeId: string
): string | null {
  const definition = getWalletSubtypeDefinition(itemType, subtypeId);
  return definition ? definition.id : null;
}

export function sanitizeWalletSubtypeFields(
  subtype: WalletSubtypeDefinition | null,
  values: Record<string, string>
): Record<string, string> {
  if (!subtype) {
    return {};
  }

  const allowedKeys = new Set<string>();
  for (const field of subtype.fields) {
    allowedKeys.add(field.key);
  }

  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!allowedKeys.has(key)) {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      sanitized[key] = trimmed;
    }
  }

  return sanitized;
}
