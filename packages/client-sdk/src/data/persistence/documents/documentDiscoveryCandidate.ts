import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type { DiscoveredDocumentInput } from "../../documents/documentSummary";
import { readRecordValue } from "../../recordReaders";

export interface DiscoveredDocumentCandidate extends DiscoveredDocumentInput {
  readonly listedContainerIds: readonly string[];
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isCandidate(value: unknown): value is DiscoveredDocumentCandidate {
  if (!isPlainObject(value)) return false;
  const level = readRecordValue(value, "effectiveAccessLevel");
  const hash = readRecordValue(value, "accessStateHash");
  const epoch = readRecordValue(value, "accessEpoch");
  return (
    typeof readRecordValue(value, "documentId") === "string" &&
    typeof readRecordValue(value, "containerId") === "string" &&
    typeof readRecordValue(value, "createdAt") === "string" &&
    typeof epoch === "number" &&
    Number.isSafeInteger(epoch) &&
    epoch > 0 &&
    (hash === undefined || hash === null || typeof hash === "string") &&
    (level === undefined ||
      level === "admin" ||
      level === "read" ||
      level === "write") &&
    isStringArray(readRecordValue(value, "linkedContainerIds")) &&
    isStringArray(readRecordValue(value, "listedContainerIds"))
  );
}

export function readStoredDiscoveryCandidate(
  json: string,
): DiscoveredDocumentCandidate {
  const value: unknown = JSON.parse(json);
  if (!isCandidate(value))
    throw new Error("Stored document discovery candidate is invalid");
  // Preserve property order: acknowledgements compare the exact stored input.
  return value;
}
