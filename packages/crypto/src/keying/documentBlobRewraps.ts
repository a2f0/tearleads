import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { normalizeCanonicalJsonValue } from "./canonical";
import {
  assertExactKeys,
  readHashString,
  readPositiveInteger,
  readString,
  throwVerification,
} from "./shared";
import type { DocumentBlobRewrap, DocumentLinkSetManifestState } from "./types";

function normalizeTarget(
  value: unknown,
): DocumentBlobRewrap["targets"][number] {
  const label = "document blob rewrap target";
  const target = assertExactKeys(
    value,
    [
      "bindingId",
      "documentId",
      "containerId",
      "containerManifestHash",
      "containerKeyEpochId",
      "containerKeyEpoch",
      "wrappedKey",
      "wrappingMetadata",
    ],
    label,
  );
  if (!isPlainObject(target.wrappingMetadata))
    throwVerification("invalid_shape", `${label} metadata must be an object`);
  return {
    bindingId: readString(target, "bindingId", label),
    documentId: readString(target, "documentId", label),
    containerId: readString(target, "containerId", label),
    containerManifestHash: readHashString(
      target,
      "containerManifestHash",
      label,
    ),
    containerKeyEpochId: readString(target, "containerKeyEpochId", label),
    containerKeyEpoch: readPositiveInteger(target, "containerKeyEpoch", label),
    wrappedKey: readString(target, "wrappedKey", label),
    wrappingMetadata: normalizeCanonicalJsonValue(
      target.wrappingMetadata,
      `${label} metadata`,
    ),
  };
}

function normalizeRewrap(entry: unknown): DocumentBlobRewrap {
  const label = "document blob rewrap";
  const record = assertExactKeys(
    entry,
    ["blobId", "contentKeyEpoch", "targets"],
    label,
  );
  if (!Array.isArray(record.targets))
    throwVerification("invalid_shape", `${label} targets must be an array`);
  const identities = new Set<string>();
  const targets = record.targets.map((value) => {
    const target = normalizeTarget(value);
    const identity = JSON.stringify([
      target.bindingId,
      target.documentId,
      target.containerId,
    ]);
    if (identities.has(identity))
      throwVerification("duplicate_entry", `${label} repeats a target`);
    identities.add(identity);
    return target;
  });
  return {
    blobId: readString(record, "blobId", label),
    contentKeyEpoch: readPositiveInteger(record, "contentKeyEpoch", label),
    targets,
  };
}

/** The complete encrypted attachment key update is covered by the link signature. */
export function normalizeDocumentBlobRewraps(
  value: unknown,
): readonly DocumentBlobRewrap[] {
  if (!Array.isArray(value))
    throwVerification(
      "invalid_shape",
      "document blob rewraps must be an array",
    );
  const blobIds = new Set<string>();
  return value.map((entry) => {
    const rewrap = normalizeRewrap(entry);
    if (blobIds.has(rewrap.blobId))
      throwVerification(
        "duplicate_entry",
        "document blob rewrap repeats a blob",
      );
    blobIds.add(rewrap.blobId);
    return rewrap;
  });
}

export function assertDocumentBlobRewrapScope(
  rewraps: readonly DocumentBlobRewrap[],
  state: DocumentLinkSetManifestState,
): void {
  for (const rewrap of rewraps) {
    const byBinding = new Map<string, Set<string>>();
    for (const target of rewrap.targets) {
      if (
        target.documentId !== state.documentId ||
        !state.linkedContainerIds.includes(target.containerId)
      )
        throwVerification(
          "object_mismatch",
          "Document blob rewrap leaves the signed document scope",
        );
      const containers = byBinding.get(target.bindingId) ?? new Set<string>();
      containers.add(target.containerId);
      byBinding.set(target.bindingId, containers);
    }
    if (
      byBinding.size === 0 ||
      [...byBinding.values()].some(
        (containers) => containers.size !== state.linkedContainerIds.length,
      )
    )
      throwVerification(
        "missing_dependency",
        "Document blob rewrap lacks a linked-container target",
      );
  }
}
