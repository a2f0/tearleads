// The SDK writing and reading a rotation baseline of several segments
// through the API's routes: a heal that cuts its history small, and a reader
// that holds nothing and pulls one update a page.
import {
  assertNoVoidedDocumentSyncUpdates,
  buildMaterializedContainerRekeyPlan,
  cacheReferencedPrincipalPolicies,
  readPullContinuation,
  type SyncRemoteDocumentRequest,
  validateDocumentSyncUpdateImports,
} from "@tearleads/client-sdk";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument as createLoroDocument,
  encodeVersionVector,
  exportFullHistoryIdentity,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getTextValue,
  getUpdateVersionVectors,
  importUpdates,
} from "@tearleads/loro";
import type { TestUser } from "@tearleads/test-utils";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createRouteSdkClient,
  documentAuthor,
  trustedResolver,
  writerResolver,
} from "./coldSdkRematerialization";
import { withProjectionHistoryRecovery } from "./projectionHistoryRecovery";
import {
  createSdkRemoteDocument,
  syncSdkRemoteDocument,
} from "./sdkRemoteDocuments";

/** Small enough that a few short edits fill several segments. */
const SEGMENT_SIZES = { maxBytes: 1024, targetBytes: 256 };
const COMMITTED_EDITS = 12;

type Doc = Awaited<ReturnType<typeof createLoroDocument>>;
type PolicyReferences = Parameters<
  typeof cacheReferencedPrincipalPolicies
>[0]["references"];

async function sdkSession(user: TestUser, label: string) {
  const { close, execSql } = await createTestExecSql(
    `api-${label}-${crypto.randomUUID()}`,
  );
  const apiClient = createRouteSdkClient(user.token);
  const resolveTrustedUserIdentity = trustedResolver(user);
  const warmReferencedPrincipalPolicies = withProjectionHistoryRecovery({
    apiClient,
    execSql,
    resolveTrustedUserIdentity,
    warmer: async (request: {
      organizationId: string;
      references: PolicyReferences;
    }) =>
      cacheReferencedPrincipalPolicies({
        execSql,
        currentPolicyReader: apiClient,
        organizationId: request.organizationId,
        references: request.references,
        reportSecurityIncident: async () => undefined,
        resolveTrustedUserIdentity,
      }),
  });
  return {
    apiClient,
    close,
    execSql,
    resolveTrustedUserIdentity,
    warmReferencedPrincipalPolicies,
  };
}

/** One edit of `document`, as the pending update a store would queue. */
function editText(document: Doc, text: string) {
  const start = encodeVersionVector(document);
  document.getText("text").update(text);
  const updateData = exportUpdatesSince(document, start);
  const vectors = getUpdateVersionVectors(updateData);
  return {
    id: crypto.randomUUID(),
    partialEndVersionVector: vectors.partialEndVersionVector,
    partialStartVersionVector: vectors.partialStartVersionVector,
    updateData: bytesToBase64(updateData),
  };
}

type IncomingValidation = NonNullable<
  SyncRemoteDocumentRequest["validateIncomingUpdates"]
>;

function validatedAgainst(document: Doc): IncomingValidation {
  return ({ decryptedUpdates, response }) =>
    validateDocumentSyncUpdateImports({
      currentDocument: document,
      decryptedUpdates,
      responseUpdates: response.updates,
    }).then(assertNoVoidedDocumentSyncUpdates);
}

/**
 * Commits several updates to a new document, then rekeys the root inline in
 * a sync that must rotate the document's content key: its baseline covers
 * the committed updates, cut into small segments.
 */
export async function healWithSegmentedBaseline(input: {
  containerId: string;
  organizationId: string;
  owner: TestUser;
}) {
  const session = await sdkSession(input.owner, "segmented-heal");
  const author = documentAuthor(input.owner, input.organizationId);
  const shared = {
    apiClient: session.apiClient,
    author,
    execSql: session.execSql,
    resolveProjectionUserKey: session.resolveTrustedUserIdentity,
    targetSecretKey: input.owner.kem.secretKey,
    warmReferencedPrincipalPolicies: session.warmReferencedPrincipalPolicies,
  };
  try {
    const created = await createSdkRemoteDocument({
      ...shared,
      containerId: input.containerId,
    });
    if (!created) throw new Error("expected the SDK to create the document");
    const document = await createLoroDocument(
      `segmented-${crypto.randomUUID()}`,
    );
    let text = "";
    const committed = [];
    for (let edit = 0; edit < COMMITTED_EDITS; edit += 1) {
      text += `${crypto.randomUUID()}${crypto.randomUUID()}\n`;
      committed.push(editText(document, text));
    }
    const first = await syncSdkRemoteDocument({
      ...shared,
      documentId: created.documentId,
      localVersionVector: null,
      pendingUpdates: committed,
      resolveWriterPublicKey: writerResolver(input.owner),
      validateIncomingUpdates: validatedAgainst(document),
      writerProjection: created.writerProjection,
    });
    if (first?.settledPendingUpdateIds.length !== committed.length) {
      throw new Error("expected the SDK to commit every update");
    }

    text += "written with the heal\n";
    const afterBaseline = editText(document, text);
    const healed = await syncSdkRemoteDocument({
      ...shared,
      buildContainerRekeys: async (writerProjection, verification) => {
        const previousProjection =
          writerProjection.authorizingContainerPaths.find(
            (projection) => projection.containerId === input.containerId,
          );
        if (!previousProjection) {
          throw new Error("inline rekey target projection is missing");
        }
        return [
          await buildMaterializedContainerRekeyPlan({
            author,
            execSql: session.execSql,
            ...verification,
            previousProjection: {
              ...previousProjection,
              policyEvidence: writerProjection.policyEvidence,
            },
            resolveProjectionUserKey: session.resolveTrustedUserIdentity,
            targetSecretKey: input.owner.kem.secretKey,
            warmReferencedPrincipalPolicies:
              session.warmReferencedPrincipalPolicies,
          }),
        ];
      },
      buildRotationSnapshot: () =>
        Promise.resolve(exportFullHistorySnapshot(document)),
      documentId: created.documentId,
      localVersionVector: encodeVersionVector(document),
      pendingUpdates: [afterBaseline],
      resolveWriterPublicKey: writerResolver(input.owner),
      rotationBaselineSegmentSizes: SEGMENT_SIZES,
      validateIncomingUpdates: validatedAgainst(document),
    });
    if (!healed?.settledPendingUpdateIds.includes(afterBaseline.id)) {
      throw new Error("expected the SDK heal to commit");
    }
    return {
      afterBaselineUpdateId: afterBaseline.id,
      committedUpdateIds: committed.map((update) => update.id),
      documentId: created.documentId,
      historyIdentity: exportFullHistoryIdentity(document),
      text,
      version: encodeVersionVector(document),
    };
  } finally {
    session.close();
  }
}

/**
 * Pulls the document as an install that holds none of it, one update a page,
 * carrying each page's continuation into the next as a store does.
 */
export async function pullDocumentAsColdSdk(input: {
  documentId: string;
  organizationId: string;
  reader: TestUser;
}) {
  const session = await sdkSession(input.reader, "segmented-reader");
  try {
    const recovered = await createLoroDocument(
      `cold-reader-${crypto.randomUUID()}`,
    );
    const servedUpdateIds: string[] = [];
    let pages = 0;
    let pullContinuation: ReturnType<typeof readPullContinuation> = null;
    let persistedState: SyncRemoteDocumentRequest["persistedState"];
    do {
      const synced = await syncSdkRemoteDocument({
        apiClient: session.apiClient,
        author: documentAuthor(input.reader, input.organizationId),
        documentId: input.documentId,
        execSql: session.execSql,
        localVersionVector: null,
        maxPageUpdates: 1,
        // What a store keeps between pages: where the pull stands, and the
        // state the last page verified.
        ...(pullContinuation ? { persistedState, pullContinuation } : {}),
        resolveProjectionUserKey: session.resolveTrustedUserIdentity,
        resolveWriterPublicKey: writerResolver(input.reader),
        targetSecretKey: input.reader.kem.secretKey,
        validateIncomingUpdates: validatedAgainst(recovered),
        warmReferencedPrincipalPolicies:
          session.warmReferencedPrincipalPolicies,
      });
      if (!synced) throw new Error("expected the cold SDK page to succeed");
      importUpdates(
        recovered,
        synced.decryptedUpdates.map((update) => update.updateData),
      );
      servedUpdateIds.push(...synced.decryptedUpdates.map(({ id }) => id));
      pages += 1;
      persistedState = synced.persistedState;
      pullContinuation = readPullContinuation(
        synced.response,
        synced.baselineGroupRun,
      );
    } while (pullContinuation);
    return {
      historyIdentity: exportFullHistoryIdentity(recovered),
      pages,
      servedUpdateIds,
      text: getTextValue(recovered),
      version: encodeVersionVector(recovered),
    };
  } finally {
    session.close();
  }
}
