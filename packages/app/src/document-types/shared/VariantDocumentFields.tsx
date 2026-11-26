import { useId, useState } from "react";
import { DocumentFieldOptionSelect } from "./DocumentFieldOptionSelect";
import {
  type DocumentFieldOption,
  getDocumentFieldOptionLabel,
} from "./documentFieldOptions";
import {
  StructuredDocumentField,
  StructuredDocumentFields,
  StructuredDocumentReadFields,
} from "./StructuredDocument";
import {
  getVisibleVariantFields,
  type VariantDocumentFieldDefinition,
} from "./variantDocumentFieldModel";

/** The picker that chooses a document's type, shown above its fields. */
export interface VariantDocumentTypeField {
  readonly ariaLabel: string;
  readonly key: string;
  readonly label: string;
  readonly options: ReadonlyArray<DocumentFieldOption>;
}

type FieldValues = Readonly<Record<string, string>>;

interface VariantFieldsViewProps {
  disabled: boolean;
  fields: FieldValues;
  /** The fields the type offers, each with its label for that type. */
  labeledFields: ReadonlyArray<{
    field: VariantDocumentFieldDefinition;
    label: string;
  }>;
  onChange: (patch: FieldValues) => void;
  ready: boolean;
  typeField: VariantDocumentTypeField;
}

function optionDisplayValue(
  options: ReadonlyArray<DocumentFieldOption>,
  value: string,
): string | undefined {
  const label = getDocumentFieldOptionLabel(options, value);
  return label.length > 0 ? label : undefined;
}

function VariantReadFields(params: VariantFieldsViewProps) {
  const { fields, typeField } = params;
  const variant = fields[typeField.key] ?? "";
  return (
    <StructuredDocumentReadFields
      fields={[
        {
          displayValue: optionDisplayValue(typeField.options, variant),
          label: typeField.label,
          value: variant,
        },
        ...params.labeledFields.map(({ field, label }) => {
          const value = fields[field.key] ?? "";
          return {
            displayValue: field.options
              ? optionDisplayValue(field.options, value)
              : undefined,
            label,
            value,
          };
        }),
      ]}
    />
  );
}

function VariantEditField(params: {
  disabled: boolean;
  field: VariantDocumentFieldDefinition;
  inputId: string;
  label: string;
  onChange: (value: string) => void;
  ready: boolean;
  value: string;
}) {
  const { disabled, field, inputId, label, onChange, ready, value } = params;
  return (
    <StructuredDocumentField inputId={inputId} label={label}>
      {field.options ? (
        <DocumentFieldOptionSelect
          ariaLabel={label}
          disabled={disabled}
          id={inputId}
          onChange={onChange}
          options={field.options}
          placeholder={ready ? (field.placeholder ?? "Select") : "Loading..."}
          value={value}
        />
      ) : (
        <input
          id={inputId}
          type={field.type ?? "text"}
          value={value}
          placeholder={ready ? field.placeholder : "Loading..."}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </StructuredDocumentField>
  );
}

function VariantEditFields(params: VariantFieldsViewProps) {
  const { disabled, fields, onChange, ready, typeField } = params;
  const id = useId();
  const typeInputId = `${id}-${typeField.key}`;
  return (
    <StructuredDocumentFields>
      <StructuredDocumentField inputId={typeInputId} label={typeField.label}>
        <DocumentFieldOptionSelect
          ariaLabel={typeField.ariaLabel}
          disabled={disabled}
          id={typeInputId}
          onChange={(value) => onChange({ [typeField.key]: value })}
          options={typeField.options}
          placeholder={ready ? "Select a type" : "Loading..."}
          value={fields[typeField.key] ?? ""}
        />
      </StructuredDocumentField>
      {params.labeledFields.map(({ field, label }) => (
        <VariantEditField
          key={field.key}
          disabled={disabled}
          field={field}
          inputId={`${id}-${field.key}`}
          label={label}
          onChange={(value) => onChange({ [field.key]: value })}
          ready={ready}
          value={fields[field.key] ?? ""}
        />
      ))}
    </StructuredDocumentFields>
  );
}

/**
 * A typed document's fields, read or edited: its type picker, then the fields
 * that type offers (see {@link getVisibleVariantFields}).
 */
export function VariantDocumentFields<
  Field extends VariantDocumentFieldDefinition,
>(params: {
  definitions: ReadonlyArray<Field>;
  disabled: boolean;
  fields: FieldValues;
  /** A field's label for the document's type; defaults to its own label. */
  getLabel?: (field: Field, variant: string) => string;
  isEditing: boolean;
  onChange: (patch: FieldValues) => void;
  ready: boolean;
  typeField: VariantDocumentTypeField;
}) {
  const { fields, getLabel, isEditing, ready, typeField } = params;
  // The fields as they stood when this edit began, so an input shown only for
  // its recorded value stays put while the user clears it.
  const [atEditStart, setAtEditStart] = useState<FieldValues | null>(null);
  if (isEditing && ready && atEditStart === null) setAtEditStart(fields);
  if (!isEditing && atEditStart !== null) setAtEditStart(null);
  const variant = fields[typeField.key] ?? "";
  const viewProps: VariantFieldsViewProps = {
    disabled: params.disabled,
    fields,
    labeledFields: getVisibleVariantFields(
      params.definitions,
      variant,
      fields,
      isEditing ? atEditStart : null,
    ).map((field) => ({
      field,
      label: getLabel?.(field, variant) ?? field.label,
    })),
    onChange: params.onChange,
    ready,
    typeField,
  };

  return isEditing ? (
    <VariantEditFields {...viewProps} />
  ) : (
    <VariantReadFields {...viewProps} />
  );
}
