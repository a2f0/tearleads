/**
 * One entry in a field's hard-coded picker (an equipment type, an insurance
 * policy type). The document stores the stable value (e.g. "leaf_blower"), not
 * the label, so the label can be reworded without touching stored documents.
 */
export interface DocumentFieldOption {
  readonly label: string;
  readonly value: string;
}

function humanizeOptionValue(value: string): string {
  return value
    .split(/[\s_-]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

/**
 * The display label for a stored option value. A value outside the option
 * list (written by a newer client with a longer list) is humanized rather than
 * dropped so the document still reads sensibly here.
 */
export function getDocumentFieldOptionLabel(
  options: ReadonlyArray<DocumentFieldOption>,
  value: string,
): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }

  return (
    options.find((option) => option.value === trimmed)?.label ??
    humanizeOptionValue(trimmed)
  );
}
