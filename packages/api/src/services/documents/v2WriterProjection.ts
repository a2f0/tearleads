import type {
  AccessManifestV2,
  DocumentLinkSetManifestStateV2,
  KeyingV2CanonicalJson,
} from "@tearleads/crypto";
import type {
  ContainerV2WriterProjectionResponse,
  DocumentV2ContentKeyBundleResponse,
  DocumentV2KekTargetsResponse,
  DocumentV2ManifestBundleResponse,
  DocumentV2WriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  getAccessManifestBundle,
  getCurrentAccessManifestHead,
} from "../../access/accessManifestStore";
import {
  type DocumentContentKeyTargetEnvelope,
  getLatestDocumentContentKeyBundle,
} from "../../access/documentContentKeyStore";
import { resolveCurrentDocumentKekTargets } from "../../access/documentKekTargets";
import type { DatabaseExecutor } from "../../adapters/postgres";
import {
  ContainerV2WriterProjectionError,
  resolveContainerV2WriterProjection,
} from "../containers/v2WriterProjection";
import type { ApiServiceRuntime } from "../runtime";

type DocumentV2WriterProjectionStatus = 403 | 404 | 409;

export class DocumentV2WriterProjectionError extends Error {
  constructor(
    message: string,
    readonly status: DocumentV2WriterProjectionStatus,
  ) {
    super(message);
    this.name = "DocumentV2WriterProjectionError";
  }
}

function toDocumentManifestBundleResponse(input: {
  readonly event: Record<string, unknown>;
  readonly manifest: AccessManifestV2;
  readonly manifestHash: string;
  readonly state: KeyingV2CanonicalJson;
}): DocumentV2ManifestBundleResponse {
  return {
    event: input.event,
    manifest: input.manifest as unknown as Record<string, unknown>,
    manifestHash: input.manifestHash,
    state: input.state as Record<string, unknown>,
  };
}

function toDocumentKekTargetsResponse(
  targets: Awaited<ReturnType<typeof resolveCurrentDocumentKekTargets>>,
): DocumentV2KekTargetsResponse {
  return {
    documentId: targets.documentId,
    linkSetManifestHash: targets.linkSetManifestHash,
    linkedContainerManifestHashes: [...targets.linkedContainerManifestHashes],
    linkedContainerKeyEpochIds: [...targets.linkedContainerKeyEpochIds],
    targets: targets.targets.map((target) => ({ ...target })),
    documentKeyTargetHash: targets.documentKeyTargetHash,
  };
}

function toContentKeyBundleResponse(input: {
  readonly bundle: {
    readonly documentId: string;
    readonly contentKeyEpoch: number;
    readonly linkSetManifestHash: string;
    readonly targetHash: string;
    readonly targets: readonly DocumentContentKeyTargetEnvelope[];
  };
}): DocumentV2ContentKeyBundleResponse {
  return {
    documentId: input.bundle.documentId,
    contentKeyEpoch: input.bundle.contentKeyEpoch,
    linkSetManifestHash: input.bundle.linkSetManifestHash,
    targetHash: input.bundle.targetHash,
    targets: input.bundle.targets.map((target) => ({
      containerId: target.containerId,
      containerManifestHash: target.containerManifestHash,
      containerKeyEpochId: target.containerKeyEpochId,
      containerKeyEpoch: target.containerKeyEpoch,
      wrappedKey: target.wrappedKey,
      wrappingMetadata: target.wrappingMetadata as Record<string, unknown>,
    })),
  };
}

function readDocumentLinkSetState(
  state: KeyingV2CanonicalJson,
): DocumentLinkSetManifestStateV2 {
  const record = state as unknown as Partial<DocumentLinkSetManifestStateV2>;

  if (
    record.version !== 2 ||
    typeof record.documentId !== "string" ||
    typeof record.organizationId !== "string" ||
    !Number.isInteger(record.epoch) ||
    !Array.isArray(record.linkedContainerIds)
  ) {
    throw new DocumentV2WriterProjectionError(
      "Document V2 manifest state is invalid",
      409,
    );
  }

  return record as DocumentLinkSetManifestStateV2;
}

async function loadCurrentDocumentManifestBundle(
  executor: DatabaseExecutor,
  documentId: string,
): Promise<DocumentV2ManifestBundleResponse> {
  const head = await getCurrentAccessManifestHead(
    "document",
    documentId,
    executor,
  );
  if (!head) {
    throw new DocumentV2WriterProjectionError(
      "Document V2 manifest head missing",
      404,
    );
  }

  const bundle = await getAccessManifestBundle(head.manifestHash, executor);
  if (!bundle || bundle.manifest.objectKind !== "document") {
    throw new DocumentV2WriterProjectionError(
      "Document V2 manifest bundle missing",
      409,
    );
  }

  return toDocumentManifestBundleResponse({
    event: bundle.event as unknown as Record<string, unknown>,
    manifest: bundle.manifest,
    manifestHash: bundle.manifestHash,
    state: bundle.state,
  });
}

async function resolveAuthorizingContainerPaths(input: {
  readonly containerIds: readonly string[];
  readonly executor: DatabaseExecutor;
  readonly userId: string;
}) {
  const results = await Promise.all(
    input.containerIds.map(
      async (
        containerId,
      ): Promise<ContainerV2WriterProjectionResponse | null> => {
        try {
          return await resolveContainerV2WriterProjection({
            containerId,
            executor: input.executor,
            userId: input.userId,
          });
        } catch (error) {
          if (
            error instanceof ContainerV2WriterProjectionError &&
            error.status === 403
          ) {
            return null;
          }

          throw error;
        }
      },
    ),
  );
  const authorizingPaths = results.filter(
    (path): path is ContainerV2WriterProjectionResponse => path !== null,
  );

  if (authorizingPaths.length === 0) {
    throw new DocumentV2WriterProjectionError("Forbidden", 403);
  }

  return authorizingPaths;
}

async function resolveDocumentWriterProjection(input: {
  readonly documentId: string;
  readonly executor: DatabaseExecutor;
  readonly userId: string;
}): Promise<DocumentV2WriterProjectionResponse> {
  const documentManifest = await loadCurrentDocumentManifestBundle(
    input.executor,
    input.documentId,
  );
  const documentState = readDocumentLinkSetState(
    documentManifest.state as KeyingV2CanonicalJson,
  );
  const [documentKekTargets, contentKeyBundle, authorizingContainerPaths] =
    await Promise.all([
      resolveCurrentDocumentKekTargets(input.documentId, input.executor),
      getLatestDocumentContentKeyBundle(input.documentId, input.executor),
      resolveAuthorizingContainerPaths({
        containerIds: documentState.linkedContainerIds,
        executor: input.executor,
        userId: input.userId,
      }),
    ]);

  if (!contentKeyBundle) {
    throw new DocumentV2WriterProjectionError(
      "Document content-key bundle missing",
      409,
    );
  }

  return {
    documentId: input.documentId,
    documentManifest,
    documentKekTargets: toDocumentKekTargetsResponse(documentKekTargets),
    contentKeyBundle: toContentKeyBundleResponse({ bundle: contentKeyBundle }),
    authorizingContainerPaths,
  };
}

export async function getDocumentV2WriterProjection(
  runtime: ApiServiceRuntime,
  input: {
    readonly documentId: string;
    readonly userId: string;
  },
): Promise<DocumentV2WriterProjectionResponse> {
  return runtime.db.transaction((tx) =>
    resolveDocumentWriterProjection({
      documentId: input.documentId,
      executor: tx,
      userId: input.userId,
    }),
  );
}
