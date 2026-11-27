import { serializeKeyingCanonicalJson } from "@tearleads/crypto";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import { MAX_DOCUMENT_SYNC_REQUEST_BYTES } from "@tearleads/validators/util";
import { serializedBytes } from "../../../data/documents/shared/sync/documentSyncOutgoingBatch";
import type { DocumentSyncPreparedUpdate } from "../../../data/documents/shared/sync/documentSyncTypes";
import { signDocumentOutgoingUpdate } from "../syncPlan/syncPlanIdentity";
import { DocumentRotationBaselineLimitError } from "./rotationBaselineErrors";
import type { StagedSegmentRecord } from "./stagedBaselineUploads";

type SigningContext = Omit<
  Parameters<typeof signDocumentOutgoingUpdate>[0],
  "update"
>;

/**
 * Signs a baseline's segments for the request that will commit them. The
 * API holds every staged header to the final segment's on what an
 * authorization check reads: the manifest, the key-target set, the epoch,
 * the writer and its key, and the cited container manifests in order.
 * `identity` is those fields. A stage whose headers were signed under
 * another identity has to sign them again before it can commit; the signed
 * time and the device are free.
 *
 * A segment is one update, and the API takes no update that serializes to
 * more than a sync request holds (`MAX_DOCUMENT_SYNC_REQUEST_BYTES`): not
 * as a staged segment's request, nor as a segment an unlink carries. The
 * cap a segment is cut at leaves about 1.3 MiB for its vectors and header;
 * a segment that is still over, signed, is refused here and never sent,
 * with `DocumentRotationBaselineLimitError`.
 */
export interface RotationBaselineSigner {
  readonly identity: string;
  sign(update: DocumentSyncPreparedUpdate): Promise<DocumentOutgoingUpdate>;
}

export function rotationBaselineSigner(
  context: SigningContext,
): RotationBaselineSigner {
  return {
    identity: serializeKeyingCanonicalJson({
      accessManifestHash: context.expectedLinkSetManifestHash,
      contentKeyEpoch: context.contentKeyEpoch,
      dependencyManifestHashes: [
        ...new Set(
          context.authorizingContainerPathRefs.flatMap((path) =>
            path.map((ref) => ref.manifestHash),
          ),
        ),
      ].sort(),
      targetHash: context.expectedTargetHash,
      writerKeyFingerprint: context.author.signerKeyFingerprint,
      writerUserId: context.author.signerUserId,
    }),
    async sign(update) {
      const signed = await signDocumentOutgoingUpdate({ ...context, update });
      if (serializedBytes(signed) > MAX_DOCUMENT_SYNC_REQUEST_BYTES) {
        throw new DocumentRotationBaselineLimitError("segment_too_large");
      }
      return signed;
    },
  };
}

/**
 * The header of a staged segment, signed again by `signer` over the same
 * content record, metadata and ciphertext: what the writer sends when its
 * staged headers went stale, without the ciphertext.
 */
export async function resignStagedSegmentHeader(
  signer: RotationBaselineSigner,
  record: StagedSegmentRecord,
): Promise<DocumentOutgoingUpdate["writeHeader"]> {
  const signed = await signer.sign({
    ciphertextHash: record.ciphertextHash,
    contentRecordId: record.contentRecordId,
    dependencyVersionVector: record.dependencyVersionVector,
    encryptedData: "",
    id: record.updateId,
    metadataHash: record.metadataHash,
    partialEndVersionVector: record.partialEndVersionVector,
    partialStartVersionVector: record.partialStartVersionVector,
    plaintextHash: record.plaintextHash,
  });
  return signed.writeHeader;
}
