import { toFingerprint } from "../fingerprint";
import { isPlainObject } from "../plainObject";
import { compareCanonicalStrings, throwVerification } from "./shared";
import type {
  DocumentContentRecordMetadataInput,
  KeyingCanonicalJson,
  KeyingCanonicalPayload,
  KeyingHashDomain,
} from "./types";

const TEXT_ENCODER = new TextEncoder();

export function normalizeCanonicalJsonValue(
  value: KeyingCanonicalJson,
  label: string,
): KeyingCanonicalJson {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throwVerification(
        "invalid_shape",
        `${label} contains a non-finite number`,
      );
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      normalizeCanonicalJsonValue(item, `${label}[${index}]`),
    );
  }

  if (!isPlainObject(value)) {
    throwVerification("invalid_shape", `${label} must be canonical JSON`);
  }

  const normalized: Record<string, KeyingCanonicalJson> = {};

  for (const key of Object.keys(value).sort(compareCanonicalStrings)) {
    const item = value[key];
    if (item === undefined) {
      throwVerification("invalid_shape", `${label}.${key} is undefined`);
    }
    normalized[key] = normalizeCanonicalJsonValue(item, `${label}.${key}`);
  }

  return normalized;
}

function stringifyNormalizedCanonicalJson(value: KeyingCanonicalJson): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    return JSON.stringify(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyNormalizedCanonicalJson(item)).join(",")}]`;
  }

  const normalizedObject = value as {
    readonly [key: string]: KeyingCanonicalJson;
  };

  return `{${Object.keys(normalizedObject)
    .sort(compareCanonicalStrings)
    .map((key) => {
      const item = normalizedObject[key];
      if (item === undefined) {
        throwVerification("invalid_shape", `payload.${key} is undefined`);
      }
      return `${JSON.stringify(key)}:${stringifyNormalizedCanonicalJson(item)}`;
    })
    .join(",")}}`;
}

function stringifyCanonicalJson(value: KeyingCanonicalJson): string {
  return stringifyNormalizedCanonicalJson(
    normalizeCanonicalJsonValue(value, "payload"),
  );
}

export function encodeDomainPayload(
  domain: KeyingHashDomain,
  payload: KeyingCanonicalJson,
): Uint8Array {
  return TEXT_ENCODER.encode(
    stringifyCanonicalJson({
      domain,
      payload,
    }),
  );
}

export function serializeKeyingCanonicalJson(
  value: KeyingCanonicalJson,
): string {
  return stringifyCanonicalJson(value);
}

export async function computeKeyingDomainHash(
  domain: KeyingHashDomain,
  payload: KeyingCanonicalJson,
): Promise<string> {
  return toFingerprint(encodeDomainPayload(domain, payload));
}

export function documentContentRecordMetadata(
  input: DocumentContentRecordMetadataInput,
): KeyingCanonicalPayload<DocumentContentRecordMetadataInput> & {
  readonly recordKind: "loro_update";
  readonly version: 1;
} {
  return {
    version: 1,
    recordKind: "loro_update",
    documentId: input.documentId,
    updateId: input.updateId,
    partialStartVersionVector: input.partialStartVersionVector,
    partialEndVersionVector: input.partialEndVersionVector,
  };
}

export async function computeDocumentContentRecordMetadataHash(
  input: DocumentContentRecordMetadataInput,
): Promise<string> {
  return computeKeyingDomainHash(
    "tearleads.document.content-record-metadata",
    documentContentRecordMetadata(input),
  );
}

export async function computeDocumentContentRecordCiphertextHash(
  encryptedData: string,
): Promise<string> {
  return computeKeyingDomainHash(
    "tearleads.document.content-record-ciphertext",
    encryptedData,
  );
}
