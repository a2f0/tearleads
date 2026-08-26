import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";
import type { DocumentLinkSetMutationRequest } from "@symcrypt/validators/request";
import type { DocumentLinkSetMutationResponse } from "@symcrypt/validators/response";
import { resolveCurrentDocumentKekTargets } from "../../../access/read/documentKekTargets";
import { storeVerifiedAccessManifestInTransaction } from "../../../access/write/accessManifestStore";
import { storeDocumentContentKeyBundleInTransaction } from "../../../access/write/documentContentKeyStore";
import { assertOrganizationCanSync } from "../../billing/organizationSyncEligibility";
import { applyContainerRekeys } from "../../containers/mutations";
import { assertRosterProfileBindingPreserved } from "../../organizations/rosterProfileBindingInvariant";
import {
  appendAtomicRotationBaseline,
  assertAtomicRotationBaselineCoversCommittedFrontier,
  assertBaselinelessUnlinkHasEmptyCommittedFrontier,
} from "./atomicRotationBaseline";
import { DocumentMutationError, toMutationError } from "./errors";
import { lockDocumentLinkSetMutationHeads } from "./linkSetMutationLocks";
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
  verifiedDocumentKekTargetsFromResolved,
} from "./shared/records";
import {
  loadCurrentDocumentManifest,
  verifyDocumentEvent,
  verifyDocumentLinkSetMutationAuthorizationFromRequest,
} from "./shared/verification";
import type { MutateDocumentLinkSetInput } from "./types";

export interface DocumentLinkSetMutationWorkflowResult {
  readonly insertedUpdateIds: readonly string[];
  readonly response: DocumentLinkSetMutationResponse;
}

function requireMutationRotationBaseline(input: {
  readonly eventType: "document.link" | "document.unlink";
  readonly request: DocumentLinkSetMutationRequest;
}) {
  const baseline = input.request.rotationBaseline;
  if (input.eventType === "document.link") {
    if (baseline) {
      throw new DocumentMutationError(
        "Document link must not include a rotation baseline",
        400,
      );
    }
    return null;
  }
  // An unlink may omit its rotation baseline only when the document has no
  // committed updates; advanceDocumentLinkSet proves that emptiness under the
  // manifest-head lock before replacing the link set.
  return baseline ?? null;
}

function toDocumentLinkSetMutationResult(input: {
  readonly contentKeyBundle: Awaited<
    ReturnType<typeof storeDocumentContentKeyBundleInTransaction>
  >;
  readonly documentId: string;
  readonly insertedUpdateIds: readonly string[];
  readonly manifest: Parameters<typeof documentManifestBundleRecord>[0];
}): DocumentLinkSetMutationWorkflowResult {
  return {
    insertedUpdateIds: input.insertedUpdateIds,
    response: {
      id: input.documentId,
      accessManifest: documentManifestBundleRecord(input.manifest),
      contentKeyBundle: toContentKeyBundleResponse(input.contentKeyBundle),
      documentKekTargets: toDocumentKekTargetsResponse(
        input.contentKeyBundle.currentTargets,
      ),
    },
  };
}

async function advanceDocumentLinkSet(input: {
  readonly baseline: DocumentLinkSetMutationRequest["rotationBaseline"];
  readonly documentId: string;
  readonly eventType: "document.link" | "document.unlink";
  readonly executor: DatabaseTransaction;
  readonly manifest: Parameters<typeof documentManifestBundleRecord>[0];
  readonly previousManifest: Parameters<typeof documentManifestBundleRecord>[0];
  readonly request: DocumentLinkSetMutationRequest;
}) {
  await assertDocumentLinkSetCanAdvance(input);
  await storeVerifiedAccessManifestInTransaction(
    { verifiedManifest: input.manifest },
    input.executor,
  );
  if (input.baseline) {
    await assertAtomicRotationBaselineCoversCommittedFrontier(input.executor, {
      baseline: input.baseline,
      documentId: input.documentId,
    });
  } else if (input.eventType === "document.unlink") {
    await assertBaselinelessUnlinkHasEmptyCommittedFrontier(input.executor, {
      documentId: input.documentId,
    });
  }
  await replaceDocumentContainerLinks({
    documentId: input.documentId,
    executor: input.executor,
    incrementAttributionRevision: input.eventType === "document.unlink",
    linkedContainerIds: input.manifest.state.linkedContainerIds,
  });
  return storeDocumentContentKeyBundleInTransaction(
    toStoredContentKeyBundleInput(
      input.documentId,
      input.request.contentKeyBundle,
    ),
    input.executor,
  );
}

async function lockDocumentLinkSetMutationFrontier(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentLinkSetMutationRequest;
}) {
  const observed = await loadCurrentDocumentManifest(
    input.documentId,
    input.executor,
  );
  await lockDocumentLinkSetMutationHeads({
    ...input,
    previousLinkedContainerIds: observed.state.linkedContainerIds,
  });
  const locked = await loadCurrentDocumentManifest(
    input.documentId,
    input.executor,
  );
  if (locked.manifestHash !== observed.manifestHash) {
    throw new DocumentMutationError("Document manifest is stale", 409);
  }
  return locked;
}

async function resolveDocumentOrganization(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
}): Promise<string> {
  const { organizationId } = await resolveCurrentDocumentKekTargets(
    input.documentId,
    input.executor,
  );
  return organizationId;
}

async function preauthorizeDocumentLinkSetMutation(input: {
  readonly documentId: string;
  readonly event: Awaited<ReturnType<typeof verifyDocumentEvent>>;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentLinkSetMutationRequest;
}): Promise<void> {
  await verifyDocumentLinkSetMutationAuthorizationFromRequest({
    event: input.event,
    executor: input.executor,
    previousManifest: await loadCurrentDocumentManifest(
      input.documentId,
      input.executor,
    ),
    request: input.request,
  });
}

async function mutateDocumentLinkSetWithExecutor(input: {
  readonly documentId: string;
  readonly eventType: "document.link" | "document.unlink";
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly request: DocumentLinkSetMutationRequest;
  readonly userId: string;
}): Promise<DocumentLinkSetMutationWorkflowResult> {
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
    // Reject unauthorized callers before acquiring organization-wide rekey
    // locks. Mutable authorization is repeated below after the merged lock
    // plan is held; this first pass prevents a caller who only knows a
    // document UUID from using this route to serialize another tenant.
    await preauthorizeDocumentLinkSetMutation({
      documentId: input.documentId,
      event,
      executor: input.executor,
      request: input.request,
    });
    const organizationId = await resolveDocumentOrganization(input);
    // Rekeys and the document organization share one group -> sorted-org lock
    // plan. Locking the document organization after independently sorted rekey
    // organizations permits opposing cross-organization requests to deadlock.
    await applyContainerRekeys({
      additionalOrganizationIds: [organizationId],
      executor: input.executor,
      fingerprint: input.fingerprint,
      requests: input.request.containerRekeys,
      userId: input.userId,
    });
    const previousManifest = await lockDocumentLinkSetMutationFrontier({
      documentId: input.documentId,
      executor: input.executor,
      request: input.request,
    });
    const authorization =
      await verifyDocumentLinkSetMutationAuthorizationFromRequest({
        event,
        executor: input.executor,
        previousManifest,
        request: input.request,
      });
    const { manifest } = authorization;
    if (manifest.state.organizationId !== organizationId) {
      throw new DocumentMutationError("Document organization mismatch", 409);
    }
    await assertRosterProfileBindingPreserved({
      executor: input.executor,
      manifest,
    });
    const rotationBaseline = requireMutationRotationBaseline(input);
    const contentKeyBundle = await advanceDocumentLinkSet({
      baseline: rotationBaseline ?? undefined,
      documentId: input.documentId,
      eventType: input.eventType,
      executor: input.executor,
      manifest,
      previousManifest,
      request: input.request,
    });

    let insertedUpdateIds: readonly string[] = [];
    if (rotationBaseline) {
      insertedUpdateIds = await appendAtomicRotationBaseline({
        baseline: rotationBaseline,
        documentId: input.documentId,
        executor: input.executor,
        fingerprint: input.fingerprint,
        manifest,
        request: input.request,
        userId: input.userId,
        writeAuthorization: {
          authorizingContainerPaths: authorization.authorizingContainerPaths,
          documentKekTargets: verifiedDocumentKekTargetsFromResolved(
            contentKeyBundle.currentTargets,
          ),
          documentManifest: manifest,
          principalPolicies: authorization.principalPolicies,
        },
      });
    }

    return toDocumentLinkSetMutationResult({
      contentKeyBundle,
      documentId: input.documentId,
      insertedUpdateIds,
      manifest,
    });
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
): Promise<DocumentLinkSetMutationWorkflowResult> {
  try {
    return await db.transaction(async (tx) => {
      const result = await mutateDocumentLinkSetWithExecutor({
        documentId: input.documentId,
        eventType: input.eventType,
        executor: tx,
        fingerprint: input.fingerprint,
        request: input.request,
        userId: input.userId,
      });
      const { organizationId } = await resolveCurrentDocumentKekTargets(
        input.documentId,
        tx,
      );
      await assertOrganizationCanSync(tx, organizationId, input.userId);
      return result;
    });
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}
