import type { ColumnMapping } from '@/hooks/useContactsImport';
import type { FieldGroup, TargetField } from './types';

// Google Contacts CSV header mappings
export const GOOGLE_CONTACTS_HEADER_MAP: Record<string, keyof ColumnMapping> = {
  'First Name': 'firstName',
  'Last Name': 'lastName',
  Birthday: 'birthday',
  'E-mail 1 - Label': 'email1Label',
  'E-mail 1 - Value': 'email1Value',
  'E-mail 2 - Label': 'email2Label',
  'E-mail 2 - Value': 'email2Value',
  'Phone 1 - Label': 'phone1Label',
  'Phone 1 - Value': 'phone1Value',
  'Phone 2 - Label': 'phone2Label',
  'Phone 2 - Value': 'phone2Value',
  'Phone 3 - Label': 'phone3Label',
  'Phone 3 - Value': 'phone3Value'
};

// Initial empty column mapping - reusable for reset functionality
export const INITIAL_COLUMN_MAPPING: ColumnMapping = {
  firstName: null,
  lastName: null,
  birthday: null,
  email1Label: null,
  email1Value: null,
  email2Label: null,
  email2Value: null,
  phone1Label: null,
  phone1Value: null,
  phone2Label: null,
  phone2Value: null,
  phone3Label: null,
  phone3Value: null
};

// Basic contact fields
export const BASIC_FIELDS: TargetField[] = [
  { key: 'firstName', label: 'First Name', required: true },
  { key: 'lastName', label: 'Last Name', required: false },
  { key: 'birthday', label: 'Birthday', required: false }
];

// Email field groups (label + value pairs)
export const EMAIL_FIELDS: FieldGroup[] = [
  { name: 'Email 1', labelKey: 'email1Label', valueKey: 'email1Value' },
  { name: 'Email 2', labelKey: 'email2Label', valueKey: 'email2Value' }
];

export const PHONE_FIELDS: FieldGroup[] = [
  { name: 'Phone 1', labelKey: 'phone1Label', valueKey: 'phone1Value' },
  { name: 'Phone 2', labelKey: 'phone2Label', valueKey: 'phone2Value' },
  { name: 'Phone 3', labelKey: 'phone3Label', valueKey: 'phone3Value' }
];

// All fields for preview purposes - dynamically generated from other constants
export const ALL_PREVIEW_FIELDS: TargetField[] = [
  ...BASIC_FIELDS.filter((f) => f.key !== 'birthday'),
  ...EMAIL_FIELDS.flatMap((group) => [
    { key: group.labelKey, label: `${group.name} Label`, required: false },
    { key: group.valueKey, label: group.name, required: false }
  ]),
  ...PHONE_FIELDS.flatMap((group) => [
    { key: group.labelKey, label: `${group.name} Label`, required: false },
    { key: group.valueKey, label: group.name, required: false }
  ]),
  ...BASIC_FIELDS.filter((f) => f.key === 'birthday')
];
