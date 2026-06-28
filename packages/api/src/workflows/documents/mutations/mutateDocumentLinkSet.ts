import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import type { DocumentLinkSetMutationRequest } from "@tearleads/validators/request";
import type { DocumentLinkSetMutationResponse } from "@tearleads/validators/response";
import { storeVerifiedAccessManifestInTransaction } from "../../../access/write/accessManifestStore";
import { storeDocumentContentKeyBundleInTransaction } from "../../../access/write/documentContentKeyStore";
import { applyContainerRekeys } from "../../containers/mutations";
import { toMutationError } from "./errors";
import {
  assertDocumentCanRelink,
  assertDocumentLinkSetCanAdvance,
  replaceDocumentContainerLinks,
} from "./shared/documentRows";
import {
  documentManifestBundleRecord,
  toContentKeyBundleResponse,
  toDocumentKekTargetsResponse,
  toStoredContentKeyBundleInput,
} from "./shared/records";
import {
  loadCurrentDocumentManifest,
  verifyDocumentEvent,
  verifyDocumentLinkSetMutationManifestFromRequest,
} from "./shared/verification";
import type { MutateDocumentLinkSetInput } from "./types";

async function mutateDocumentLinkSetWithExecutor(input: {
  readonly documentId: string;
  readonly eventType: "document.link" | "document.unlink";
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly request: DocumentLinkSetMutationRequest;
  readonly userId: string;
}): Promise<DocumentLinkSetMutationResponse> {
  try {
    await assertDocumentCanRelink({
      documentId: input.documentId,
      executor: input.executor,
    });
    const event = await verifyDocumentEvent({
      body: input.request.body,
      event: input.request.event,
      expectedDocumentId: input.documentId,
      expectedEventType: input.eventType,
      executor: input.executor,
      fingerprint: input.fingerprint,
      userId: input.userId,
    });
    // See createDocumentWithExecutor: rekeys must land before current path
    // validation so callers can recover from stale KEK material in one write.
    await applyContainerRekeys({
      executor: input.executor,
      fingerprint: input.fingerprint,
      requests: input.request.containerRekeys,
      userId: input.userId,
    });
    const previousManifest = await loadCurrentDocumentManifest(
      input.documentId,
      input.executor,
    );
    const manifest = await verifyDocumentLinkSetMutationManifestFromRequest({
      event,
      executor: input.executor,
      previousManifest,
      request: input.request,
    });

    await assertDocumentLinkSetCanAdvance({
      documentId: input.documentId,
      executor: input.executor,
      manifest,
      previousManifest,
    });
    await storeVerifiedAccessManifestInTransaction(
      { verifiedManifest: manifest },
      input.executor,
    );
    await replaceDocumentContainerLinks({
      documentId: input.documentId,
      executor: input.executor,
      linkedContainerIds: manifest.state.linkedContainerIds,
    });

    const contentKeyBundle = await storeDocumentContentKeyBundleInTransaction(
      toStoredContentKeyBundleInput(
        input.documentId,
        input.request.contentKeyBundle,
      ),
      input.executor,
    );

    return {
      id: input.documentId,
      accessManifest: documentManifestBundleRecord(manifest),
      contentKeyBundle: toContentKeyBundleResponse(contentKeyBundle),
      documentKekTargets: toDocumentKekTargetsResponse(
        contentKeyBundle.currentTargets,
      ),
    };
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}

export async function runDocumentLinkSetMutationWorkflow(
  db: ApiDatabase,
  input: MutateDocumentLinkSetInput,
): Promise<DocumentLinkSetMutationResponse> {
  try {
    return await db.transaction((tx) =>
      mutateDocumentLinkSetWithExecutor({
        documentId: input.documentId,
        eventType: input.eventType,
        executor: tx,
        fingerprint: input.fingerprint,
        request: input.request,
        userId: input.userId,
      }),
    );
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}
