import {
  computeDocumentContentKeyTargetHash,
  type DocumentContentKeyTarget,
  type KeyingCanonicalJson,
} from "@symcrypt/crypto";
import type { DocumentSyncErrorCode } from "@symcrypt/validators/response";
import { createContentKeyTargetPolicy } from "./contentKeyTargetPolicy";
import type { resolveCurrentDocumentKekTargets } from "./documentKekTargets";

export type CurrentDocumentKekTargets = Awaited<
  ReturnType<typeof resolveCurrentDocumentKekTargets>
>;

export interface DocumentContentKeyTargetEnvelope
  extends DocumentContentKeyTarget {
  readonly wrappedKey: string;
  readonly wrappingMetadata: KeyingCanonicalJson;
}

export interface StoredDocumentContentKeyBundle {
  readonly documentId: string;
  readonly contentKeyEpoch: number;
  readonly linkSetManifestHash: string;
  readonly targetHash: string;
  readonly targets: readonly DocumentContentKeyTargetEnvelope[];
}

export interface StoredDocumentContentKeyBundleWithTargets
  extends StoredDocumentContentKeyBundle {
  readonly currentTargets: CurrentDocumentKekTargets;
}

export class DocumentContentKeyBundleError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
    readonly code?: DocumentSyncErrorCode | undefined,
  ) {
    super(message);
    this.name = "DocumentContentKeyBundleError";
  }
}

function toTargetFields(
  envelope: DocumentContentKeyTargetEnvelope,
): DocumentContentKeyTarget {
  return {
    containerId: envelope.containerId,
    containerManifestHash: envelope.containerManifestHash,
    containerKeyEpochId: envelope.containerKeyEpochId,
    containerKeyEpoch: envelope.containerKeyEpoch,
  };
}

const contentKeyTargetPolicy = createContentKeyTargetPolicy<
  DocumentContentKeyTarget,
  DocumentContentKeyTargetEnvelope,
  CurrentDocumentKekTargets
>({
  computeTargetHash: computeDocumentContentKeyTargetHash,
  createError: (message, status) =>
    new DocumentContentKeyBundleError(message, status),
  messages: {
    duplicateTargets:
      "Document content-key targets contain duplicate containers",
    hashMismatch: "Document content-key target hash mismatch",
    invalidEpoch: "Document content key epoch must be a positive integer",
    missingWrappedMaterial:
      "Document content-key target is missing wrapped key material",
    targetsMismatch:
      "Document content-key targets do not match current KEK targets",
  },
  targetIdentityEqual: (left, right) => left.containerId === right.containerId,
  targetKey: (target) => target.containerId,
  toTargetFields,
});

export const {
  assertTargetHashMatches,
  ensurePositiveContentKeyEpoch,
  sortTargetEnvelopes,
  targetEnvelopeEqual,
  targetEnvelopeMaterialEqual,
  targetKeyMaterialEqual,
} = contentKeyTargetPolicy;

export function assertTargetsMatchCurrent(input: {
  readonly currentTargets: CurrentDocumentKekTargets;
  readonly targets: readonly DocumentContentKeyTargetEnvelope[];
}): void {
  contentKeyTargetPolicy.assertTargetsMatchCurrent(input);
}
