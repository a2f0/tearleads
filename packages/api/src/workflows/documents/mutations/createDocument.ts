import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import type { DocumentCreateRequest } from "@tearleads/validators/request";
import type { DocumentCreateResponse } from "@tearleads/validators/response";
import { resolveCurrentDocumentKekTargets } from "../../../access/read/documentKekTargets";
import { storeVerifiedAccessManifestInTransaction } from "../../../access/write/accessManifestStore";
import { storeDocumentContentKeyBundleInTransaction } from "../../../access/write/documentContentKeyStore";
import { assertOrganizationCanSync } from "../../billing/organizationSyncEligibility";
import { applyContainerRekeys } from "../../containers/mutations";
import { DocumentMutationError, toMutationError } from "./errors";
import {
  assertCreateCanAdvanceDocumentHead,
  insertDocumentAndLinks,
} from "./shared/documentRows";
import {
  documentManifestBundleRecord,
  toContentKeyBundleResponse,
  toDocumentKekTargetsResponse,
  toStoredContentKeyBundleInput,
} from "./shared/records";
import {
  verifyDocumentEvent,
  verifyDocumentManifestFromRequest,
} from "./shared/verification";
import type { CreateDocumentInput } from "./types";

export async function runCreateDocumentWorkflow(
  db: ApiDatabase,
  input: CreateDocumentInput,
): Promise<DocumentCreateResponse> {
  try {
    return await db.transaction(async (tx) => {
      const created = await createDocumentWithExecutor({
        executor: tx,
        fingerprint: input.fingerprint,
        request: input.request,
        userId: input.userId,
      });
      // Public boundary: registration bootstraps its documents via
      // createDocumentWithExecutor directly, so gate only here.
      const { organizationId } = await resolveCurrentDocumentKekTargets(
        created.id,
        tx,
      );
      await assertOrganizationCanSync(tx, organizationId, input.userId);
      return created;
    });
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}

export async function createDocumentWithExecutor(input: {
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly request: DocumentCreateRequest;
  readonly userId: string;
}): Promise<DocumentCreateResponse> {
  try {
    const event = await verifyDocumentEvent({
      body: input.request.body,
      event: input.request.event,
      expectedEventType: "document.link",
      executor: input.executor,
      fingerprint: input.fingerprint,
      userId: input.userId,
    });
    // Optional rekeys are key maintenance, not document authorization. Apply
    // them before path/target validation so this write may reference the new
    // container head that it just committed in the same transaction.
    await applyContainerRekeys({
      executor: input.executor,
      fingerprint: input.fingerprint,
      requests: input.request.containerRekeys,
      userId: input.userId,
    });
    const manifest = await verifyDocumentManifestFromRequest({
      event,
      executor: input.executor,
      request: input.request,
    });

    if (
      manifest.state.epoch !== 1 ||
      manifest.state.previousManifestHash !== null
    ) {
      throw new DocumentMutationError(
        "Document create requires an initial link-set manifest",
        400,
      );
    }

    await assertCreateCanAdvanceDocumentHead(
      input.executor,
      manifest.state.documentId,
    );
    const document = await insertDocumentAndLinks({
      createdByFingerprint: input.fingerprint,
      executor: input.executor,
      manifest,
    });
    await storeVerifiedAccessManifestInTransaction(
      { verifiedManifest: manifest },
      input.executor,
    );
    const contentKeyBundle = await storeDocumentContentKeyBundleInTransaction(
      toStoredContentKeyBundleInput(
        manifest.state.documentId,
        input.request.contentKeyBundle,
      ),
      input.executor,
    );

    return {
      id: document.id,
      createdAt: document.createdAt.toISOString(),
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
