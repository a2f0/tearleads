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
import { MAX_DOCUMENT_BASELINE_STAGE_BYTES } from "@tearleads/validators/util";
import { and, eq, sql } from "drizzle-orm";
import {
  type DocumentBaselineStageRow,
  documentBaselineStageExpiry,
  judgeDocumentBaselineStage,
} from "../../../documents/documentBaselineStageState";
import {
  type DocumentBaselineStageKey,
  lockDocumentBaselineStageRow,
  readStagedSegmentAt,
} from "../../../documents/documentBaselineStageStore";
import { writeHeaderAuthorizationHash } from "../../../documents/writeHeaderAuthorizationHash";
import { loadSignerPublicKey } from "../../signerPublicKey";
import { DocumentMutationError } from "../mutations/errors";
import { verifyStagedWriteHeaderSignature } from "../mutations/outgoingUpdateVerification";
import {
  documentBaselineStageTooLarge,
  requireOpenDocumentBaselineStage,
  stagedSegmentConflict,
  stagedSegmentOutOfOrder,
  toDocumentBaselineStageError,
} from "./errors";
import { requireStageWriter } from "./stageAccess";
import { writeHeaderBytes } from "./stagedSegmentRows";
import { documentBaselineStageStatus } from "./stageLifecycle";

export interface ResignStagedBaselineSegmentHeaderInput
  extends DocumentBaselineStageKey {
  readonly fingerprint: string;
  readonly now?: Date | undefined;
  readonly segmentIndex: number;
  readonly userId: string;
  readonly writeHeader: unknown;
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
  const held = await readStagedSegmentAt(executor, stage, input.segmentIndex);
  if (!held) throw stagedSegmentOutOfOrder(stage.nextSegmentIndex);
  const verified = await verifyStagedWriteHeaderSignature({
    contentKeyEpoch: stage.contentKeyEpoch,
    documentId: stage.documentId,
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
  // The stage's byte count holds each header it stores. A header signed
  // again may be larger, so the stage is held to its bound by the
  // difference, under the stage's row lock, and the count stays true.
  const addedBytes =
    writeHeaderBytes(verified.header) - writeHeaderBytes(held.header);
  if (stage.stagedBytes + addedBytes > MAX_DOCUMENT_BASELINE_STAGE_BYTES) {
    throw documentBaselineStageTooLarge("byte cap");
  }
  await executor
    .update(documentBaselineSegments)
    .set({
      authorizationHash: writeHeaderAuthorizationHash(verified.header),
      header: verified.header,
      headerHash: verified.headerHash,
    })
    .where(eq(documentBaselineSegments.updateId, held.updateId));
  const [touched] = await executor
    .update(documentBaselineStages)
    .set({
      expiresAt: documentBaselineStageExpiry(stage.createdAt, now),
      stagedBytes: sql`${documentBaselineStages.stagedBytes} + ${addedBytes}`,
    })
    .where(
      and(
        eq(documentBaselineStages.documentId, stage.documentId),
        eq(documentBaselineStages.id, stage.id),
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
 * its final segment names. Like staging a segment it is a document write,
 * held to the caller's access and its organization's standing now, and to
 * the stage's byte bound.
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
      await requireStageWriter({
        documentId: stage.documentId,
        executor,
        userId: input.userId,
      });
      return documentBaselineStageStatus(
        await replaceStagedHeader(executor, input, stage, now),
      );
    });
  } catch (error) {
    throw toDocumentBaselineStageError(error, stagedSegmentConflict) ?? error;
  }
}
