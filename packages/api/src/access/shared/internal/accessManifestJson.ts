import type {
  AnyVerifiedAccessManifest,
  ContainerAccessManifestState,
  DocumentLinkSetManifestState,
  KeyingCanonicalJson,
  ReferencedPrincipalHead,
  VerifiedAccessEvent,
  VerifiedDocumentLinkSetManifest,
} from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";

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

function containerDirectGrantsCanonicalJson(
  directGrants: ContainerAccessManifestState["directGrants"],
): KeyingCanonicalJson {
  return directGrants.map((grant) => ({
    accessLevel: grant.accessLevel,
    subjectId: grant.subjectId,
    subjectType: grant.subjectType,
  }));
}

function containerAccessManifestStateCanonicalJson(
  state: ContainerAccessManifestState,
): KeyingCanonicalJson {
  return {
    version: state.version,
    containerId: state.containerId,
    organizationId: state.organizationId,
    epoch: state.epoch,
    previousManifestHash: state.previousManifestHash,
    eventHash: state.eventHash,
    parentContainerId: state.parentContainerId,
    parentManifestHash: state.parentManifestHash,
    metadataDocumentId: state.metadataDocumentId,
    containerKeyEpochId: state.containerKeyEpochId,
    directGrants: containerDirectGrantsCanonicalJson(state.directGrants),
    referencedPrincipalHeads: referencedPrincipalHeadsCanonicalJson(
      state.referencedPrincipalHeads,
    ),
  };
}

function documentLinkSetStateCanonicalJson(
  state: DocumentLinkSetManifestState,
): KeyingCanonicalJson {
  return {
    version: state.version,
    documentId: state.documentId,
    organizationId: state.organizationId,
    epoch: state.epoch,
    previousManifestHash: state.previousManifestHash,
    eventHash: state.eventHash,
    linkedContainerIds: [...state.linkedContainerIds],
  };
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
    return containerAccessManifestStateCanonicalJson(state);
  }

  if ("documentId" in state) {
    return documentLinkSetStateCanonicalJson(state);
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
): KeyingCanonicalJson {
  return principalHeads.map((principalHead) => ({
    principalType: principalHead.principalType,
    principalId: principalHead.principalId,
    version: principalHead.version,
    keyEpoch: principalHead.keyEpoch,
    stateHash: principalHead.stateHash,
    keyFingerprint: principalHead.keyFingerprint,
  }));
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
  return value === "group" || value === "organization" || value === "user";
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
