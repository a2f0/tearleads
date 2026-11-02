import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { z } from "zod";
import {
  parseProjection,
  projectionNullableString,
  projectionPlainRecord,
  projectionRecord,
  projectionString,
  projectionStringArray,
} from "../../keyingProjectionSchemas";
import { DocumentWriterProjectionError } from "./writerProjectionError";

/**
 * The few stored bundle fields the document writer projection walks before
 * it verifies anything: predecessor, parent, and cited manifest hashes.
 */

function projectionError(message: string): DocumentWriterProjectionError {
  return new DocumentWriterProjectionError(message, 409);
}

const previousManifestHashField = z.object({
  previousManifestHash: projectionNullableString,
});
const parentManifestHashField = z.object({
  parentManifestHash: projectionNullableString,
});
const documentIdField = z.object({ documentId: projectionString });
const eventDependencyManifestHashesSchema = projectionRecord({
  event: projectionRecord({ dependencyManifestHashes: projectionStringArray }),
});
/** The label suffix for an issue at each depth of the event bundle. */
const eventDependencyLabels = [
  "event bundle",
  "event",
  "event dependencyManifestHashes",
] as const;

function readPlainRecord(value: unknown, label: string) {
  return parseProjection(projectionPlainRecord, value, label, projectionError);
}

export function readManifestPreviousManifestHash(
  bundle: AccessManifestBundleWireResponse,
  label: string,
): string | null {
  const manifest = readPlainRecord(bundle.manifest, `${label} manifest`);

  return parseProjection(
    previousManifestHashField,
    manifest,
    label,
    projectionError,
  ).previousManifestHash;
}

export function readContainerParentManifestHash(
  bundle: AccessManifestBundleWireResponse,
  label: string,
): string | null {
  const state = readPlainRecord(bundle.state, `${label} state`);

  return parseProjection(parentManifestHashField, state, label, projectionError)
    .parentManifestHash;
}

export function readEventDependencyManifestHashes(
  bundle: AccessManifestBundleWireResponse,
  label: string,
): string[] {
  const parsed = eventDependencyManifestHashesSchema.safeParse(bundle.event);
  if (parsed.success) {
    return parsed.data.event.dependencyManifestHashes;
  }
  const depth = parsed.error.issues[0]?.path.length ?? 0;
  const part = eventDependencyLabels[depth] ?? eventDependencyLabels[0];
  throw projectionError(`${label} ${part} is invalid`);
}

export function readDocumentManifestDocumentId(state: unknown): string {
  return parseProjection(
    documentIdField,
    state,
    "Document manifest state",
    projectionError,
  ).documentId;
}
