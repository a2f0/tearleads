import type {
  AccessManifest,
  DocumentLinkSetManifestState,
  KeyingCanonicalJson,
  VerifiedAccessEvent,
} from "@tearleads/crypto";
import type {
  ContainerWriterProjectionResponse,
  DocumentContentKeyBundleResponse,
  DocumentKekTargetsResponse,
  DocumentManifestBundleResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { DocumentContentKeyBundleError } from "../../access/errors/documentContentKeyStore";
import {
  getAccessManifestBundle,
  getCurrentAccessManifestHead,
} from "../../access/read/accessManifestStore";
import {
  type DocumentContentKeyTargetEnvelope,
  getLatestCurrentDocumentContentKeyBundle,
} from "../../access/read/documentContentKeyStore";
import {
  DocumentKekTargetError,
  resolveCurrentDocumentKekTargets,
} from "../../access/read/documentKekTargets";
import type { DatabaseExecutor } from "../../adapters/postgres";
import {
  type ContainerWriterProjectionContext,
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
  resolveContainerWriterProjection,
} from "../containers/writerProjection";
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
  readProjectionVersion,
} from "../keyingProjectionRecords";
import type { ApiServiceRuntime } from "../runtime";

type DocumentWriterProjectionStatus = 403 | 404 | 409;

export class DocumentWriterProjectionError extends Error {
  constructor(
    message: string,
    readonly status: DocumentWriterProjectionStatus,
  ) {
    super(message);
    this.name = "DocumentWriterProjectionError";
  }
}

function projectionError(message: string): DocumentWriterProjectionError {
  return new DocumentWriterProjectionError(message, 409);
}

function readPlainRecord(value: unknown, label: string) {
  return readProjectionPlainRecord(value, label, projectionError);
}

function readCanonicalRecord(value: KeyingCanonicalJson, label: string) {
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

function readVersion(record: Record<string, unknown>, label: string) {
  return readProjectionVersion(record, label, projectionError);
}

const readValue = readProjectionValue;
const accessManifestRecord = projectionAccessManifestRecord;
const verifiedAccessEventRecord = projectionVerifiedAccessEventRecord;

function toDocumentManifestBundleResponse(input: {
  readonly event: VerifiedAccessEvent;
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
  readonly state: KeyingCanonicalJson;
}): DocumentManifestBundleResponse {
  return {
    event: verifiedAccessEventRecord(input.event),
    manifest: accessManifestRecord(input.manifest),
    manifestHash: input.manifestHash,
    state: readCanonicalRecord(input.state, "Document manifest state"),
  };
}

function toDocumentKekTargetsResponse(
  targets: Awaited<ReturnType<typeof resolveCurrentDocumentKekTargets>>,
): DocumentKekTargetsResponse {
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
}): DocumentContentKeyBundleResponse {
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
        "Document content-key target wrapping metadata",
      ),
    })),
  };
}

function readDocumentLinkSetState(
  state: unknown,
): DocumentLinkSetManifestState {
  const record = readPlainRecord(state, "Document manifest state");
  readVersion(record, "Document manifest state");
  const linkedContainerIds = readStringArray(
    readValue(record, "linkedContainerIds"),
    "Document manifest state.linkedContainerIds",
  );

  return {
    version: 1,
    documentId: readString(record, "documentId", "Document manifest state"),
    organizationId: readString(
      record,
      "organizationId",
      "Document manifest state",
    ),
    epoch: readPositiveInteger(record, "epoch", "Document manifest state"),
    previousManifestHash: readNullableString(
      record,
      "previousManifestHash",
      "Document manifest state",
    ),
    eventHash: readString(record, "eventHash", "Document manifest state"),
    linkedContainerIds,
  };
}

async function loadCurrentDocumentManifestBundle(
  executor: DatabaseExecutor,
  documentId: string,
): Promise<DocumentManifestBundleResponse> {
  const head = await getCurrentAccessManifestHead(
    "document",
    documentId,
    executor,
  );
  if (!head) {
    throw new DocumentWriterProjectionError(
      "Document manifest head missing",
      404,
    );
  }

  const bundle = await getAccessManifestBundle(head.manifestHash, executor);
  if (!bundle || bundle.manifest.objectKind !== "document") {
    throw new DocumentWriterProjectionError(
      "Document manifest bundle missing",
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
  readonly context: ContainerWriterProjectionContext;
  readonly executor: DatabaseExecutor;
  readonly userId: string;
}) {
  const results = await Promise.all(
    input.containerIds.map(
      async (
        containerId,
      ): Promise<ContainerWriterProjectionResponse | null> => {
        try {
          return await resolveContainerWriterProjection({
            containerId,
            context: input.context,
            executor: input.executor,
            userId: input.userId,
          });
        } catch (error) {
          if (
            error instanceof ContainerWriterProjectionError &&
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
    (path): path is ContainerWriterProjectionResponse => path !== null,
  );

  if (authorizingPaths.length === 0) {
    throw new DocumentWriterProjectionError("Forbidden", 403);
  }

  return authorizingPaths;
}

async function resolveDocumentWriterProjection(input: {
  readonly documentId: string;
  readonly executor: DatabaseExecutor;
  readonly userId: string;
}): Promise<DocumentWriterProjectionResponse> {
  const documentManifest = await loadCurrentDocumentManifestBundle(
    input.executor,
    input.documentId,
  );
  const documentState = readDocumentLinkSetState(documentManifest.state);
  const containerProjectionContext = createContainerWriterProjectionContext(
    input.executor,
  );
  let documentKekTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  let authorizingContainerPaths: Awaited<
    ReturnType<typeof resolveAuthorizingContainerPaths>
  >;
  try {
    [documentKekTargets, authorizingContainerPaths] = await Promise.all([
      resolveCurrentDocumentKekTargets(input.documentId, input.executor),
      resolveAuthorizingContainerPaths({
        containerIds: documentState.linkedContainerIds,
        context: containerProjectionContext,
        executor: input.executor,
        userId: input.userId,
      }),
    ]);
  } catch (error) {
    if (error instanceof DocumentKekTargetError) {
      throw new DocumentWriterProjectionError(error.message, error.status);
    }
    throw error;
  }
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
      throw new DocumentWriterProjectionError(error.message, 409);
    }
    throw error;
  }

  if (!contentKeyBundle) {
    throw new DocumentWriterProjectionError(
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

export async function getDocumentWriterProjection(
  runtime: ApiServiceRuntime,
  input: {
    readonly documentId: string;
    readonly userId: string;
  },
): Promise<DocumentWriterProjectionResponse> {
  return runtime.db.transaction((tx) =>
    resolveDocumentWriterProjection({
      documentId: input.documentId,
      executor: tx,
      userId: input.userId,
    }),
  );
}
