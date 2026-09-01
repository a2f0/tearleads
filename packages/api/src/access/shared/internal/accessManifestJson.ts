import type {
  AnyVerifiedAccessManifest,
  ContainerAccessManifestState,
  KeyingCanonicalJson,
  ReferencedPrincipalHead,
  VerifiedAccessEvent,
  VerifiedDocumentLinkSetManifest,
} from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import {
  containerAccessManifestStateRecord,
  documentLinkSetStateRecord,
  projectionReferencedPrincipalHeadRecord,
} from "../../../keyingProjectionRecords";

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

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isManagedPrincipalKind(
  value: unknown,
): value is ReferencedPrincipalHead["principalType"] {
  return value === "group" || value === "organization";
}

export function isReferencedPrincipalHead(
  value: unknown,
): value is ReferencedPrincipalHead {
  if (!isPlainObject(value)) {
    return false;
  }

  return (
    isManagedPrincipalKind(Reflect.get(value, "principalType")) &&
    typeof Reflect.get(value, "principalId") === "string" &&
    typeof Reflect.get(value, "version") === "number" &&
    typeof Reflect.get(value, "keyEpoch") === "number" &&
    typeof Reflect.get(value, "stateHash") === "string" &&
    typeof Reflect.get(value, "keyFingerprint") === "string"
  );
}

type ContainerDirectGrant =
  ContainerAccessManifestState["directGrants"][number];

function isContainerAccessLevel(
  value: unknown,
): value is ContainerDirectGrant["accessLevel"] {
  return value === "admin" || value === "read" || value === "write";
}

function isContainerGrantSubjectType(
  value: unknown,
): value is ContainerDirectGrant["subjectType"] {
  return value === "group" || value === "user";
}

export function isContainerDirectGrant(
  value: unknown,
): value is ContainerDirectGrant {
  if (!isPlainObject(value)) {
    return false;
  }

  return (
    isContainerAccessLevel(Reflect.get(value, "accessLevel")) &&
    typeof Reflect.get(value, "subjectId") === "string" &&
    isContainerGrantSubjectType(Reflect.get(value, "subjectType"))
  );
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
