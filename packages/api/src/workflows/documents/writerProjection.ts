import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import type { DocumentLinkSetManifestState } from "@tearleads/crypto";
import type {
  AccessManifestBundleWireResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { DOCUMENT_PROJECTION_ERROR_CODES } from "@tearleads/validators/response";
import { listDocumentContentWriteDependencyHashes } from "../../access/read/contentWriteDependencies";
import {
  DocumentKekTargetError,
  resolveCurrentDocumentKekTargets,
} from "../../access/read/documentKekTargets";
import { recordDocumentManifestObservationInTransaction } from "../../access/write/documentManifestObservationStore";
import {
  type ContainerWriterProjectionContext,
  createContainerWriterProjectionContext,
} from "../containers/writerProjection";
import { flushVerificationMarkersAfterRead } from "../containers/writerProjection/verificationMarkers";
import { runPrincipalHistoryTransaction } from "../principals/principalHistoryTransaction";
import { loadObservedDocumentManifestBundle } from "./documentManifestBundle";
import {
  toContentKeyBundleResponse,
  toDocumentKekTargetsResponse,
} from "./mutations/shared/records";
import {
  StoredDocumentManifestError,
  verifyStoredDocumentManifest,
} from "./storedDocumentManifestVerification";
import { readDocumentManifestDocumentId } from "./writerProjectionBundleFields";
import { resolveAuthorizingContainerPathCandidates } from "./writerProjectionContainerPaths";
import { loadWriterProjectionContentKey } from "./writerProjectionContentKey";
import { DocumentWriterProjectionError } from "./writerProjectionError";
import {
  type LoadedProjectionManifestBundle,
  loadDocumentContainerDependencyMaterial,
  loadDocumentManifestHistory,
} from "./writerProjectionManifestDependencies";
import { loadDocumentProjectionPolicyEvidence } from "./writerProjectionPolicyEvidence";

export { DocumentWriterProjectionError } from "./writerProjectionError";

function projectionError(message: string): DocumentWriterProjectionError {
  return new DocumentWriterProjectionError(message, 409);
}

async function loadDocumentWriterProjectionVerificationMaterial(input: {
  readonly documentManifest: AccessManifestBundleWireResponse;
  readonly executor: DatabaseSession;
}): Promise<
  Pick<
    DocumentWriterProjectionResponse,
    | "documentContainerManifestHistory"
    | "documentManifestContainerPaths"
    | "documentManifestHistory"
  >
> {
  const manifestCache = new Map<string, LoadedProjectionManifestBundle>();
  manifestCache.set(input.documentManifest.manifestHash, {
    bundle: input.documentManifest,
    objectKind: "document",
  });
  const documentManifestHistory = await loadDocumentManifestHistory({
    ...input,
    manifestCache,
  });
  const containerMaterial = await loadDocumentContainerDependencyMaterial({
    ...input,
    additionalDependencyManifestHashes:
      await listDocumentContentWriteDependencyHashes(
        readDocumentManifestDocumentId(input.documentManifest.state),
        input.executor,
      ),
    documentManifestHistory,
    manifestCache,
  });

  return {
    documentManifestHistory,
    ...containerMaterial,
  };
}

async function resolveAuthorizingContainerPaths(input: {
  readonly containerIds: readonly string[];
  readonly context: ContainerWriterProjectionContext;
  readonly executor: DatabaseSession;
  readonly userId: string;
}) {
  const candidates = await resolveAuthorizingContainerPathCandidates(input);
  if (candidates.paths.length === 0) {
    throw new DocumentWriterProjectionError("Forbidden", 403);
  }

  return candidates.paths;
}

async function resolveDocumentWriterProjection(input: {
  readonly documentManifest: AccessManifestBundleWireResponse;
  readonly containerProjectionContext: ContainerWriterProjectionContext;
  readonly documentId: string;
  readonly executor: DatabaseSession;
  readonly userId: string;
}): Promise<DocumentWriterProjectionResponse> {
  const { containerProjectionContext } = input;
  const { documentManifest } = input;
  let documentState: DocumentLinkSetManifestState;
  try {
    documentState = (
      await verifyStoredDocumentManifest({
        bundle: documentManifest,
        containerContext: containerProjectionContext,
      })
    ).state;
  } catch (error) {
    if (error instanceof StoredDocumentManifestError) {
      throw new DocumentWriterProjectionError(error.message, 409);
    }
    throw error;
  }
  let documentKekTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  let authorizingContainerPaths: Awaited<
    ReturnType<typeof resolveAuthorizingContainerPaths>
  >;
  try {
    // Run sequentially: this projection always executes inside a transaction,
    // so both reads share one pinned connection. Issuing them concurrently
    // only trips pg's already-executing-query deprecation without parallelism.
    documentKekTargets = await resolveCurrentDocumentKekTargets(
      input.documentId,
      input.executor,
      true,
    );
    authorizingContainerPaths = await resolveAuthorizingContainerPaths({
      containerIds: documentState.linkedContainerIds,
      context: containerProjectionContext,
      executor: input.executor,
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof DocumentKekTargetError) {
      // The coded existence check above already ran, so a 404 here (e.g. a
      // link-set head that vanished mid-projection) is not proof of deletion;
      // keep it away from the client's 404-triggered wipe.
      throw new DocumentWriterProjectionError(
        error.message,
        error.status === 404 ? 409 : error.status,
        DOCUMENT_PROJECTION_ERROR_CODES.kekTargetsUnavailable,
      );
    }
    throw error;
  }
  const contentKeyBundle = await loadWriterProjectionContentKey(
    input.executor,
    input.documentId,
    documentKekTargets,
  );
  const verificationMaterial =
    await loadDocumentWriterProjectionVerificationMaterial({
      documentManifest,
      executor: input.executor,
    });

  return {
    documentId: input.documentId,
    documentManifest,
    ...verificationMaterial,
    documentKekTargets: toDocumentKekTargetsResponse(documentKekTargets),
    contentKeyBundle: toContentKeyBundleResponse(
      contentKeyBundle.bundle,
      projectionError,
    ),
    // A bundle wrapped to superseded KEK targets is served, not suppressed:
    // clients that span the rotation heal it by re-wrapping the content key
    // (a 409 here would deny them the current targets they need to do so).
    ...(contentKeyBundle.stale ? { contentKeyBundleStale: true as const } : {}),
    authorizingContainerPaths,
    policyEvidence: await loadDocumentProjectionPolicyEvidence({
      executor: input.executor,
      organizationId: documentState.organizationId,
      documentId: input.documentId,
      userId: input.userId,
      documentManifest,
      ...verificationMaterial,
      authorizingContainerPaths,
    }),
  };
}

export async function runDocumentWriterProjectionWorkflow(
  db: ApiDatabase,
  input: {
    readonly documentId: string;
    readonly userId: string;
  },
): Promise<DocumentWriterProjectionResponse> {
  const { markers, projection } = await runPrincipalHistoryTransaction(
    db,
    async (tx) => {
      const containerProjectionContext =
        createContainerWriterProjectionContext(tx);
      const { bundle: documentManifest, observed } =
        await loadObservedDocumentManifestBundle(
          tx,
          input.documentId,
          input.userId,
          containerProjectionContext.verificationMarkers,
        );
      const projection = await resolveDocumentWriterProjection({
        documentManifest,
        containerProjectionContext,
        documentId: input.documentId,
        executor: tx,
        userId: input.userId,
      });
      if (!observed)
        await recordDocumentManifestObservationInTransaction(tx, {
          documentId: input.documentId,
          manifestHash: projection.documentManifest.manifestHash,
          userId: input.userId,
        });
      return {
        markers: containerProjectionContext.verificationMarkers,
        projection,
      };
    },
  );
  await flushVerificationMarkersAfterRead(markers, db);
  return projection;
}
