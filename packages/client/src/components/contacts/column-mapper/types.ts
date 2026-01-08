import type { ColumnMapping, ParsedCSV } from '@/hooks/useContactsImport';

export type { ColumnMapping, ParsedCSV };

export interface TargetField {
  key: keyof ColumnMapping;
  label: string;
  required: boolean;
}

export interface FieldGroup {
  name: string;
  labelKey: keyof ColumnMapping;
  valueKey: keyof ColumnMapping;
}
