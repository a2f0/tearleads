import {
  computeAccessEventHash,
  computeAccessManifestHash,
  type DocumentLinkSetManifestState,
  deriveDocumentLinkSetManifest,
} from "@tearleads/crypto";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type { DocumentCreateResponse } from "@tearleads/validators/response";
import {
  canonicalKeyingJsonString,
  readCanonicalRecord,
} from "../../keyingCanonicalJson";
import {
  readAccessEvent,
  readAccessManifest,
} from "../../keyingProjectionVerification/readers";
import {
  readRecordInteger,
  readRecordNullableString,
  readRecordPositiveInteger,
  readRecordString,
  readRecordValue,
  readStringArray,
} from "../../recordReaders";

function readDocumentLinkSetManifestState(
  value: unknown,
  label: string,
): DocumentLinkSetManifestState {
  const record = readCanonicalRecord(value, label);
  if (readRecordInteger(record, "version", label) !== 1) {
    throw new Error(`${label}.version must be 1`);
  }

  return {
    version: 1,
    documentId: readRecordString(record, "documentId", label),
    organizationId: readRecordString(record, "organizationId", label),
    epoch: readRecordPositiveInteger(record, "epoch", label),
    previousManifestHash: readRecordNullableString(
      record,
      "previousManifestHash",
      label,
    ),
    eventHash: readRecordString(record, "eventHash", label),
    linkedContainerIds: readStringArray(
      readRecordValue(record, "linkedContainerIds"),
      `${label}.linkedContainerIds`,
    ),
  };
}

export function serializeCanonical(value: unknown, label: string): string {
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    throw new Error(`Document create response ${label} is invalid`);
  }

  return canonicalKeyingJsonString(value, `Document create response ${label}`);
}

export async function assertDocumentManifestBundleConsistent(input: {
  bundle: DocumentCreateResponse["accessManifest"];
  label: string;
}): Promise<{ documentId: string; organizationId: string }> {
  const manifestHash = await computeAccessManifestHash(
    readAccessManifest(input.bundle.manifest, `${input.label} manifest`),
  );
  if (manifestHash !== input.bundle.manifestHash) {
    throw new Error(`${input.label} manifest hash mismatch`);
  }

  const eventBundle = input.bundle.event;
  if (!isPlainRecord(eventBundle)) {
    throw new Error(`${input.label} event bundle is invalid`);
  }
  const eventHash = readRecordString(eventBundle, "eventHash", input.label);
  const event = Reflect.get(eventBundle, "event");
  const accessEvent = readAccessEvent(event, `${input.label} signed event`);
  const computedEventHash = await computeAccessEventHash(accessEvent);
  if (computedEventHash !== eventHash) {
    throw new Error(`${input.label} event hash mismatch`);
  }

  const state = readDocumentLinkSetManifestState(
    input.bundle.state,
    `${input.label} state`,
  );
  if (state.eventHash !== eventHash) {
    throw new Error(`${input.label} state event hash mismatch`);
  }
  const derivedManifest = await deriveDocumentLinkSetManifest(state);
  if (
    serializeCanonical(input.bundle.manifest, "manifest") !==
    serializeCanonical(derivedManifest, "manifest")
  ) {
    throw new Error(`${input.label} manifest state mismatch`);
  }

  return {
    documentId: state.documentId,
    organizationId: state.organizationId,
  };
}
