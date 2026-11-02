import type {
  AnyVerifiedAccessManifest,
  ContainerAccessManifestState,
  KeyingCanonicalJson,
  ReferencedPrincipalHead,
  VerifiedAccessEvent,
  VerifiedDocumentLinkSetManifest,
} from "@tearleads/crypto";
import { z } from "zod";
import {
  containerAccessManifestStateRecord,
  documentLinkSetStateRecord,
  projectionReferencedPrincipalHeadRecord,
} from "../../../keyingProjectionRecords";
import { projectionPlainRecord } from "../../../keyingProjectionSchemas";

export function accessEventDependencyHashes(
  event: VerifiedAccessEvent,
): string[] {
  return [...event.event.dependencyManifestHashes];
}

export function accessManifestReferencedHeads(
  manifest: AnyVerifiedAccessManifest,
): ReferencedPrincipalHead[] {
  return manifest.manifest.referencedPrincipalHeads.map((principalHead) => ({
    ...principalHead,
  }));
}

function unrecognizedAccessManifestState(state: never): never {
  throw new Error(`Unrecognized access manifest state: ${String(state)}`);
}

export function accessManifestState(
  manifest: AnyVerifiedAccessManifest,
): KeyingCanonicalJson {
  if (!("state" in manifest)) {
    return {};
  }

  const { state } = manifest;
  if ("containerId" in state) {
    return containerAccessManifestStateRecord(state);
  }

  if ("documentId" in state) {
    return documentLinkSetStateRecord(state);
  }

  return unrecognizedAccessManifestState(state);
}

export function documentLinkSetState(
  manifest: AnyVerifiedAccessManifest,
): VerifiedDocumentLinkSetManifest["state"] | null {
  if (manifest.manifest.objectKind !== "document" || !("state" in manifest)) {
    return null;
  }

  const { state } = manifest;
  if (
    !("documentId" in state) ||
    state.documentId !== manifest.manifest.objectId ||
    !Array.isArray(state.linkedContainerIds)
  ) {
    return null;
  }

  return state;
}

export function containerManifestState(
  manifest: AnyVerifiedAccessManifest,
): ContainerAccessManifestState | null {
  if (manifest.manifest.objectKind !== "container" || !("state" in manifest)) {
    return null;
  }

  const { state } = manifest;
  if (
    !("containerId" in state) ||
    state.containerId !== manifest.manifest.objectId ||
    !Array.isArray(state.directGrants)
  ) {
    return null;
  }

  return state;
}

export function referencedPrincipalHeadsCanonicalJson(
  principalHeads: readonly ReferencedPrincipalHead[],
) {
  return principalHeads.map(projectionReferencedPrincipalHeadRecord);
}

/**
 * Stored JSON lists are checked, not rebuilt: an item that passes reaches
 * the caller as the stored value itself.
 */
/** Any JavaScript number, as `typeof` reads it (NaN included). */
const anyNumber = z.custom<number>((value) => typeof value === "number");

const storedReferencedPrincipalHeadSchema = projectionPlainRecord.pipe(
  z.object({
    principalType: z.enum(["group", "organization"]),
    principalId: z.string(),
    version: anyNumber,
    keyEpoch: anyNumber,
    stateHash: z.string(),
    keyFingerprint: z.string(),
  }),
);

const storedContainerDirectGrantSchema = projectionPlainRecord.pipe(
  z.object({
    accessLevel: z.enum(["admin", "read", "write"]),
    subjectId: z.string(),
    subjectType: z.enum(["group", "user"]),
  }),
);

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isReferencedPrincipalHead(
  value: unknown,
): value is ReferencedPrincipalHead {
  return storedReferencedPrincipalHeadSchema.safeParse(value).success;
}

type ContainerDirectGrant =
  ContainerAccessManifestState["directGrants"][number];

export function isContainerDirectGrant(
  value: unknown,
): value is ContainerDirectGrant {
  return storedContainerDirectGrantSchema.safeParse(value).success;
}

export function readAccessVersion(value: number, label: string): 1 {
  if (value !== 1) {
    throw new Error(`${label} version is invalid`);
  }

  return 1;
}

export function readJsonArray<T>(
  value: unknown,
  label: string,
  isItem: (value: unknown) => value is T,
): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} is not an array`);
  }

  const items: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isItem(item)) {
      throw new Error(`${label}[${index}] is invalid`);
    }
    items.push(item);
  }

  return items;
}
