import type {
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import type { VerifiedDocumentLinkSetManifest } from "@tearleads/crypto";
import { satisfiesVersionVector } from "@tearleads/loro";
import type {
  DocumentLinkSetMutationRequest,
  DocumentOutgoingUpdate,
} from "@tearleads/validators/request";
import { DOCUMENT_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { loadSignerPublicKey } from "../../signerPublicKey";
import { appendDocumentUpdates } from "./appendOutgoingUpdates";
import {
  committedFrontierAfterBaselineCursor,
  hasCommittedDocumentUpdate,
} from "./committedDocumentUpdates";
import { DocumentMutationError } from "./errors";
import { requireOutgoingBaselineGroup } from "./outgoingBaselineGroup";
import type { DocumentWriteAuthorizationProof } from "./types";

/**
 * Prove that the baseline carried by an unlink is one whole group and covers
 * the committed frontier after its signed cursor. What a group covers is
 * read from its segments' spans. The caller must hold the document
 * manifest-head write lock through this read and the subsequent append; sync
 * writers take the same exclusive lock, so no old-key update can appear
 * between them. The append, in the same transaction, verifies every
 * segment's signature and that its declared fields are the signed ones, and
 * `appendAtomicRotationBaseline` refuses a group it did not insert whole.
 */
export async function assertAtomicRotationBaselineCoversCommittedFrontier(
  executor: DatabaseSession,
  input: {
    readonly baseline: readonly DocumentOutgoingUpdate[];
    readonly documentId: string;
  },
): Promise<void> {
  const group = await requireOutgoingBaselineGroup({
    documentId: input.documentId,
    segments: input.baseline,
  });
  const committedFrontier = await committedFrontierAfterBaselineCursor(
    executor,
    {
      coversThroughUpdateId: group.coversThroughUpdateId,
      documentId: input.documentId,
    },
  );
  if (!satisfiesVersionVector(group.coverage, committedFrontier)) {
    throw new DocumentMutationError(
      "Document unlink rotation baseline is stale",
      409,
      DOCUMENT_MUTATION_ERROR_CODES.unlinkRotationBaselineStale,
    );
  }
}

/**
 * A baseline-less unlink is sound only when the document has no committed
 * updates at all: with an empty committed frontier there is no old-epoch
 * payload a rotation baseline would need to dominate, so rotating the content
 * key without a replayable baseline cannot orphan history. The caller must
 * hold the document manifest-head write lock through this read and the
 * link-set replacement; sync writers take the same exclusive lock, so no
 * update can commit between this emptiness proof and the unlink.
 */
export async function assertBaselinelessUnlinkHasEmptyCommittedFrontier(
  executor: DatabaseSession,
  input: { readonly documentId: string },
): Promise<void> {
  if (await hasCommittedDocumentUpdate(executor, input.documentId)) {
    // Same refusal as a stale baseline: the client's empty-history proof no
    // longer covers the committed frontier, so it proves again and retries.
    throw new DocumentMutationError(
      "Document unlink requires a rotation baseline covering committed updates",
      409,
      DOCUMENT_MUTATION_ERROR_CODES.unlinkRotationBaselineStale,
    );
  }
}

/**
 * Append the unlink's baseline, every segment in index order in one insert.
 * The caller's transaction commits the group with the unlink or not at all.
 * Every segment must be newly inserted: one whose id is committed already
 * would leave the unlink anchored by a group written only in part, so the
 * unlink is refused and rolls back.
 */
export async function appendAtomicRotationBaseline(input: {
  readonly baseline: readonly DocumentOutgoingUpdate[];
  /** The stored commitment of the epoch the unlink opened. */
  readonly contentKeyCommitment: string;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly manifest: VerifiedDocumentLinkSetManifest;
  readonly request: DocumentLinkSetMutationRequest;
  readonly userId: string;
  readonly writeAuthorization: DocumentWriteAuthorizationProof;
}): Promise<readonly string[]> {
  const appendResult = await appendDocumentUpdates({
    accessEpoch: input.manifest.state.epoch,
    contentKeyCommitment: input.contentKeyCommitment,
    documentId: input.documentId,
    documentInsertedInTransaction: false,
    executor: input.executor,
    fingerprint: input.fingerprint,
    organizationId: input.manifest.state.organizationId,
    request: {
      authorizingContainerPathRefs: input.request.authorizingContainerPathRefs,
      contentKeyBundle: input.request.contentKeyBundle,
      contentKeyEpoch: input.request.contentKeyBundle.contentKeyEpoch,
      expectedLinkSetManifestHash: input.manifest.manifestHash,
      expectedTargetHash: input.request.contentKeyBundle.targetHash,
      localVersionVector: null,
      outgoingUpdates: [...input.baseline],
      supportsPullPagination: true,
    },
    signingPublicKey: await loadSignerPublicKey(input.executor, {
      ...input,
      error: (message, status) => new DocumentMutationError(message, status),
    }),
    userId: input.userId,
    writeAuthorization: input.writeAuthorization,
  });
  if (
    input.baseline.some(
      (segment) => !appendResult.insertedUpdateIds.has(segment.id),
    )
  ) {
    throw new DocumentMutationError(
      "Document rotation baseline was not inserted",
      409,
    );
  }

  return [...appendResult.insertedUpdateIds];
}
