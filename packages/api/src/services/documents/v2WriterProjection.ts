import type {
  AccessManifestV2,
  DocumentLinkSetManifestStateV2,
  KeyingV2CanonicalJson,
  VerifiedAccessEvent,
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
  DocumentContentKeyBundleError,
  type DocumentContentKeyTargetEnvelope,
  getLatestCurrentDocumentContentKeyBundle,
} from "../../access/documentContentKeyStore";
import { resolveCurrentDocumentKekTargets } from "../../access/documentKekTargets";
import type { DatabaseExecutor } from "../../adapters/postgres";
import {
  ContainerV2WriterProjectionError,
  resolveContainerV2WriterProjection,
} from "../containers/v2WriterProjection";
import {
  projectionAccessManifestRecord,
  projectionVerifiedAccessEventRecord,
  readProjectionNullableString,
  readProjectionPlainRecord,
  readProjectionPositiveInteger,
  readProjectionRecord,
  readProjectionString,
  readProjectionStringArray,
  readProjectionValue,
  readProjectionVersion2,
} from "../keyingV2ProjectionRecords";
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

function projectionError(message: string): DocumentV2WriterProjectionError {
  return new DocumentV2WriterProjectionError(message, 409);
}

function readPlainRecord(value: unknown, label: string) {
  return readProjectionPlainRecord(value, label, projectionError);
}

function readCanonicalRecord(value: KeyingV2CanonicalJson, label: string) {
  return readProjectionRecord(value, label, projectionError);
}

function readString(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  return readProjectionString(record, key, label, projectionError);
}

function readNullableString(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  return readProjectionNullableString(record, key, label, projectionError);
}

function readPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  return readProjectionPositiveInteger(record, key, label, projectionError);
}

function readStringArray(value: unknown, label: string) {
  return readProjectionStringArray(value, label, projectionError);
}

function readVersion2(record: Record<string, unknown>, label: string) {
  return readProjectionVersion2(record, label, projectionError);
}

const readValue = readProjectionValue;
const accessManifestRecord = projectionAccessManifestRecord;
const verifiedAccessEventRecord = projectionVerifiedAccessEventRecord;

function toDocumentManifestBundleResponse(input: {
  readonly event: VerifiedAccessEvent;
  readonly manifest: AccessManifestV2;
  readonly manifestHash: string;
  readonly state: KeyingV2CanonicalJson;
}): DocumentV2ManifestBundleResponse {
  return {
    event: verifiedAccessEventRecord(input.event),
    manifest: accessManifestRecord(input.manifest),
    manifestHash: input.manifestHash,
    state: readCanonicalRecord(input.state, "Document V2 manifest state"),
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
      wrappingMetadata: readCanonicalRecord(
        target.wrappingMetadata,
        "Document V2 content-key target wrapping metadata",
      ),
    })),
  };
}

function readDocumentLinkSetState(
  state: unknown,
): DocumentLinkSetManifestStateV2 {
  const record = readPlainRecord(state, "Document V2 manifest state");
  readVersion2(record, "Document V2 manifest state");
  const linkedContainerIds = readStringArray(
    readValue(record, "linkedContainerIds"),
    "Document V2 manifest state.linkedContainerIds",
  );

  return {
    version: 2,
    documentId: readString(record, "documentId", "Document V2 manifest state"),
    organizationId: readString(
      record,
      "organizationId",
      "Document V2 manifest state",
    ),
    epoch: readPositiveInteger(record, "epoch", "Document V2 manifest state"),
    previousManifestHash: readNullableString(
      record,
      "previousManifestHash",
      "Document V2 manifest state",
    ),
    eventHash: readString(record, "eventHash", "Document V2 manifest state"),
    linkedContainerIds,
  };
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
    event: bundle.event,
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
  const documentState = readDocumentLinkSetState(documentManifest.state);
  const [documentKekTargets, authorizingContainerPaths] = await Promise.all([
    resolveCurrentDocumentKekTargets(input.documentId, input.executor),
    resolveAuthorizingContainerPaths({
      containerIds: documentState.linkedContainerIds,
      executor: input.executor,
      userId: input.userId,
    }),
  ]);
  let contentKeyBundle: Awaited<
    ReturnType<typeof getLatestCurrentDocumentContentKeyBundle>
  >;
  try {
    contentKeyBundle = await getLatestCurrentDocumentContentKeyBundle(
      {
        currentTargets: documentKekTargets,
        documentId: input.documentId,
      },
      input.executor,
    );
  } catch (error) {
    if (error instanceof DocumentContentKeyBundleError) {
      throw new DocumentV2WriterProjectionError(error.message, 409);
    }
    throw error;
  }

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
