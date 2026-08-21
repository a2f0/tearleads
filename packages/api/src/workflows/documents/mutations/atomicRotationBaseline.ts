import type {
  DatabaseSession,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";
import { documentUpdates } from "@symcrypt/api-shared/schema";
import type { VerifiedDocumentLinkSetManifest } from "@symcrypt/crypto";
import { mergeVersionVectors, satisfiesVersionVector } from "@symcrypt/loro";
import type {
  DocumentLinkSetMutationRequest,
  DocumentOutgoingUpdate,
} from "@symcrypt/validators/request";
import { eq } from "drizzle-orm";
import { documentAuditAccessFromManifest } from "../../../documents/documentAuditAccess";
import { isAuthenticatedReplayableBaseline } from "../../../documents/documentReplayableBaseline";
import { loadSignerPublicKey } from "../../signerPublicKey";
import { appendDocumentUpdates } from "./appendOutgoingUpdates";
import { DocumentMutationError } from "./errors";
import { readWriteHeader } from "./shared/records";
import type { DocumentWriteAuthorizationProof } from "./types";

function requireRotationBaselineMetadata(update: DocumentOutgoingUpdate) {
  if (
    update.checkpointKind !== "rotate_baseline" ||
    update.checkpointPayloadKind !== "full_history_snapshot" ||
    !update.sourceVersionVector
  ) {
    throw new DocumentMutationError(
      "Document unlink requires a replayable rotation baseline",
      400,
    );
  }

  return {
    checkpointKind: update.checkpointKind,
    checkpointPayloadKind: update.checkpointPayloadKind,
    sourceVersionVector: update.sourceVersionVector,
  };
}

/**
 * Prove that the baseline carried by an unlink is authenticated and covers the
 * complete committed frontier. The caller must hold the document manifest-head
 * write lock through this read and the subsequent append; sync writers take the
 * corresponding shared lock, so no old-key update can appear between them.
 */
export async function assertAtomicRotationBaselineCoversCommittedFrontier(
  executor: DatabaseSession,
  input: {
    readonly baseline: DocumentOutgoingUpdate;
    readonly documentId: string;
  },
): Promise<void> {
  const metadata = requireRotationBaselineMetadata(input.baseline);
  const header = readWriteHeader(
    input.baseline.writeHeader,
    "Document rotation baseline write header",
  );
  if (
    !(await isAuthenticatedReplayableBaseline({
      checkpointKind: metadata.checkpointKind,
      documentId: input.documentId,
      metadataHash: header.metadataHash,
      partialEndVersionVector: input.baseline.partialEndVersionVector,
      partialStartVersionVector: input.baseline.partialStartVersionVector,
      plaintextHash: input.baseline.plaintextHash,
      sourceVersionVector: metadata.sourceVersionVector,
      updateId: input.baseline.id,
    }))
  ) {
    throw new DocumentMutationError(
      "Document unlink rotation baseline is not replayable",
      400,
    );
  }

  const committedUpdates = await executor
    .select({
      partialEndVersionVector: documentUpdates.partialEndVersionVector,
    })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, input.documentId));
  const committedFrontier = mergeVersionVectors(
    committedUpdates.map((update) => update.partialEndVersionVector),
  );
  if (
    !satisfiesVersionVector(metadata.sourceVersionVector, committedFrontier)
  ) {
    throw new DocumentMutationError(
      "Document unlink rotation baseline is stale",
      409,
    );
  }
}

/**
 * A baseline-less unlink is sound only when the document has no committed
 * updates at all: with an empty committed frontier there is no old-epoch
 * payload a rotation baseline would need to dominate, so rotating the content
 * key without a replayable baseline cannot orphan history. The caller must
 * hold the document manifest-head write lock through this read and the
 * link-set replacement; sync writers take the corresponding shared lock, so no
 * update can commit between this emptiness proof and the unlink.
 */
export async function assertBaselinelessUnlinkHasEmptyCommittedFrontier(
  executor: DatabaseSession,
  input: { readonly documentId: string },
): Promise<void> {
  const [committedUpdate] = await executor
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, input.documentId))
    .limit(1);
  if (committedUpdate) {
    throw new DocumentMutationError(
      "Document unlink requires a rotation baseline covering committed updates",
      409,
    );
  }
}

export async function appendAtomicRotationBaseline(input: {
  readonly baseline: DocumentOutgoingUpdate;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly manifest: VerifiedDocumentLinkSetManifest;
  readonly request: DocumentLinkSetMutationRequest;
  readonly userId: string;
  readonly writeAuthorization: DocumentWriteAuthorizationProof;
}): Promise<readonly string[]> {
  const appendResult = await appendDocumentUpdates({
    ...(await documentAuditAccessFromManifest(input.manifest)),
    documentId: input.documentId,
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
      outgoingUpdates: [input.baseline],
    },
    signingPublicKey: await loadSignerPublicKey(input.executor, {
      ...input,
      error: (message, status) => new DocumentMutationError(message, status),
    }),
    userId: input.userId,
    writeAuthorization: input.writeAuthorization,
  });
  if (!appendResult.insertedUpdateIds.has(input.baseline.id)) {
    throw new DocumentMutationError(
      "Document rotation baseline was not inserted",
      409,
    );
  }

  return [...appendResult.insertedUpdateIds];
}
