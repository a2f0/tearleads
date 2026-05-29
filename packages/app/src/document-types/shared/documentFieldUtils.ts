import type { DocumentFieldValidationIssue } from "@tearleads/client-sdk";

export function addFormatIssue(
  issues: DocumentFieldValidationIssue[],
  field: string,
  value: string,
  message: string,
): void {
  if (value.length === 0) {
    return;
  }

  issues.push({
    field,
    message,
    value,
  });
}

export function nullableField(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isTruthyStructuredField(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}
