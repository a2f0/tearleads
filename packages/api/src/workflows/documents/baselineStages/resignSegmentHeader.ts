import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  documentBaselineSegments,
  documentBaselineStages,
} from "@tearleads/api-shared/schema";
import type { WriteHeader } from "@tearleads/crypto";
import type { DocumentBaselineStageStatusResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import {
  type DocumentBaselineStageRow,
  documentBaselineStageExpiry,
  judgeDocumentBaselineStage,
} from "../../../documents/documentBaselineStageState";
import {
  type DocumentBaselineStageKey,
  lockDocumentBaselineStageRow,
} from "../../../documents/documentBaselineStageStore";
import { writeHeaderAuthorizationHash } from "../../../documents/writeHeaderAuthorizationHash";
import { loadSignerPublicKey } from "../../signerPublicKey";
import { DocumentMutationError } from "../mutations/errors";
import { verifyStagedWriteHeaderSignature } from "../mutations/outgoingUpdateVerification";
import {
  requireOpenDocumentBaselineStage,
  stagedSegmentConflict,
  stagedSegmentOutOfOrder,
  toDocumentBaselineStageError,
} from "./errors";
import { documentBaselineStageStatus } from "./stageLifecycle";

export interface ResignStagedBaselineSegmentHeaderInput
  extends DocumentBaselineStageKey {
  readonly fingerprint: string;
  readonly now?: Date | undefined;
  readonly segmentIndex: number;
  readonly userId: string;
  readonly writeHeader: unknown;
}

function stagedSegmentIs(input: ResignStagedBaselineSegmentHeaderInput) {
  return and(
    eq(documentBaselineSegments.documentId, input.documentId),
    eq(documentBaselineSegments.baselineId, input.baselineId),
    eq(documentBaselineSegments.segmentIndex, input.segmentIndex),
  );
}

/**
 * A re-signed header is for the bytes already staged: the same content
 * record, signed metadata, ciphertext and nonce domain. Those are what bind
 * a header to its payload and what the stage's digest chains, so neither the
 * stored ciphertext nor the digest changes.
 */
function signsTheStagedBytes(held: WriteHeader, sent: WriteHeader): boolean {
  return (
    held.contentRecordId === sent.contentRecordId &&
    held.metadataHash === sent.metadataHash &&
    held.ciphertextHash === sent.ciphertextHash &&
    held.nonceDomainHash === sent.nonceDomainHash &&
    held.encryptionSuite === sent.encryptionSuite
  );
}

async function replaceStagedHeader(
  executor: DatabaseTransaction,
  input: ResignStagedBaselineSegmentHeaderInput,
  stage: DocumentBaselineStageRow,
  now: Date,
): Promise<DocumentBaselineStageRow> {
  const [held] = await executor
    .select({ header: documentBaselineSegments.header })
    .from(documentBaselineSegments)
    .where(stagedSegmentIs(input))
    .limit(1);
  if (!held) throw stagedSegmentOutOfOrder(stage.nextSegmentIndex);
  const verified = await verifyStagedWriteHeaderSignature({
    contentKeyEpoch: stage.contentKeyEpoch,
    documentId: input.documentId,
    organizationId: stage.organizationId,
    signingPublicKey: await loadSignerPublicKey(executor, {
      ...input,
      error: (message, status) => new DocumentMutationError(message, status),
    }),
    userId: input.userId,
    writeHeader: input.writeHeader,
  });
  if (!signsTheStagedBytes(held.header, verified.header)) {
    throw stagedSegmentConflict();
  }
  await executor
    .update(documentBaselineSegments)
    .set({
      authorizationHash: writeHeaderAuthorizationHash(verified.header),
      header: verified.header,
      headerHash: verified.headerHash,
    })
    .where(stagedSegmentIs(input));
  const [touched] = await executor
    .update(documentBaselineStages)
    .set({ expiresAt: documentBaselineStageExpiry(stage.createdAt, now) })
    .where(
      and(
        eq(documentBaselineStages.documentId, input.documentId),
        eq(documentBaselineStages.id, input.baselineId),
      ),
    )
    .returning();
  if (!touched) throw new Error("Document baseline stage was not updated");
  return touched;
}

/**
 * Replace a staged segment's write header with one signed again over the
 * same bytes. A writer whose plan moved while it uploaded (another manifest
 * head, key-target set or signing key) signs its staged headers again and
 * sends only those: the commit requires every staged header to name what
 * its final segment names.
 */
export async function resignStagedBaselineSegmentHeader(
  db: ApiDatabase,
  input: ResignStagedBaselineSegmentHeaderInput,
): Promise<DocumentBaselineStageStatusResponse> {
  const now = input.now ?? new Date();
  try {
    return await db.transaction(async (executor) => {
      const stage = requireOpenDocumentBaselineStage(
        judgeDocumentBaselineStage(
          await lockDocumentBaselineStageRow(executor, input),
          { now, userId: input.userId },
        ),
      );
      return documentBaselineStageStatus(
        await replaceStagedHeader(executor, input, stage, now),
      );
    });
  } catch (error) {
    throw toDocumentBaselineStageError(error, stagedSegmentConflict) ?? error;
  }
}
