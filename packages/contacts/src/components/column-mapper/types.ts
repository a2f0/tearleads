import type { ColumnMapping } from '../../hooks/useContactsImport';

export type { ColumnMapping };

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
