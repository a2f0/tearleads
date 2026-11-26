import type { DocumentFieldOption } from "./documentFieldOptions";

/**
 * One field of a kind whose type picker decides which fields its editor
 * offers (an insurance policy's type, a license's type).
 */
export interface VariantDocumentFieldDefinition {
  readonly key: string;
  readonly label: string;
  /** A hard-coded picker in place of a text input. */
  readonly options?: ReadonlyArray<DocumentFieldOption>;
  readonly placeholder?: string;
  readonly type?: "date" | "tel";
  /** The types that offer this field; absent, every type does. */
  readonly variants?: ReadonlyArray<string>;
}

/**
 * The fields to show for a document of type `variant`. A variant field is
 * offered for its types, and also whenever it holds a value, so changing the
 * type never hides what was recorded. An editor passes the fields as they
 * stood when editing began, so clearing such a value keeps its input in place
 * until the edit ends.
 */
export function getVisibleVariantFields<
  Field extends VariantDocumentFieldDefinition,
>(
  definitions: ReadonlyArray<Field>,
  variant: string,
  fields: Readonly<Record<string, string>>,
  atEditStart?: Readonly<Record<string, string>> | null,
): ReadonlyArray<Field> {
  const type = variant.trim();
  const holdsValue = (source: Readonly<Record<string, string>>, key: string) =>
    (source[key] ?? "").trim().length > 0;
  return definitions.filter(
    (field) =>
      field.variants === undefined ||
      field.variants.includes(type) ||
      holdsValue(fields, field.key) ||
      (atEditStart != null && holdsValue(atEditStart, field.key)),
  );
}
