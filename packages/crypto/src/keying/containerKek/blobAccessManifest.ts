import { computeKeyingDomainHash } from "../canonical";
import type { KeyingCanonicalPayload } from "../canonicalJsonTypes";
import type { BlobAccessManifest } from "../contentKeyTargetTypes";
import {
  assertExactKeys,
  normalizeUniqueSortedStrings,
  readHashString,
  readString,
  readStringArray,
  readVersion,
  throwVerification,
} from "../shared";

function normalizeHashStringArray(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string[] {
  const values = normalizeUniqueSortedStrings(
    readStringArray(record, key, label),
    `${label}.${key}`,
  );

  for (const [index, value] of values.entries()) {
    if (!/^[0-9a-f]{64}$/.test(value)) {
      throwVerification(
        "hash_mismatch",
        `${label}.${key}[${index}] must be a 64-character lowercase hex hash`,
      );
    }
  }

  return values;
}

function normalizeBlobAccessManifest(value: unknown): BlobAccessManifest {
  const record = assertExactKeys(
    value,
    [
      "activeBindingIds",
      "blobId",
      "blobKeyTargetHash",
      "documentManifestHashes",
      "linkedContainerKeyEpochIds",
      "linkedContainerManifestHashes",
      "organizationId",
      "version",
    ],
    "blob access manifest",
  );

  return {
    version: readVersion(record, "blob access manifest"),
    blobId: readString(record, "blobId", "blob access manifest"),
    organizationId: readString(
      record,
      "organizationId",
      "blob access manifest",
    ),
    activeBindingIds: normalizeUniqueSortedStrings(
      readStringArray(record, "activeBindingIds", "blob access manifest"),
      "blob access manifest.activeBindingIds",
    ),
    documentManifestHashes: normalizeHashStringArray(
      record,
      "documentManifestHashes",
      "blob access manifest",
    ),
    linkedContainerManifestHashes: normalizeHashStringArray(
      record,
      "linkedContainerManifestHashes",
      "blob access manifest",
    ),
    linkedContainerKeyEpochIds: normalizeUniqueSortedStrings(
      readStringArray(
        record,
        "linkedContainerKeyEpochIds",
        "blob access manifest",
      ),
      "blob access manifest.linkedContainerKeyEpochIds",
    ),
    blobKeyTargetHash: readHashString(
      record,
      "blobKeyTargetHash",
      "blob access manifest",
    ),
  };
}

export async function computeBlobAccessManifestHash(
  manifest: BlobAccessManifest,
): Promise<string> {
  const payload: KeyingCanonicalPayload<BlobAccessManifest> =
    normalizeBlobAccessManifest(manifest);

  return computeKeyingDomainHash(
    "tearleads.keying.blob-access-manifest",
    payload,
  );
}
