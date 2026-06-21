import type {
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { buildDocumentCreatePlan } from "../../data/documents/shared/events";
import { wrapDocumentContentKeyForCreate } from "../../data/documents/shared/projection";
import { persistedDocumentCreateStateFromResponse } from "../../data/documents/shared/responses";
import type {
  CreateRemoteDocumentResult,
  DocumentCreateApi,
  DocumentCreateAuthor,
  MaterializedDocumentCreatePlan,
  ProjectionVerificationOptions,
} from "../../data/documents/shared/types";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { requireProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export async function buildMaterializedDocumentCreatePlan(
  input: {
    author: DocumentCreateAuthor;
    containerProjection: ContainerWriterProjectionResponse;
    contentKey?: Uint8Array | undefined;
    contentKeyEpoch?: number | undefined;
    documentId?: string | undefined;
    eventId?: string | undefined;
    execSql?: ExecSql | undefined;
    knownContainerKeks?: ReadonlyMap<string, Uint8Array> | undefined;
    signedAt?: string | undefined;
    targetSecretKey: Uint8Array;
  } & ProjectionVerificationOptions,
): Promise<MaterializedDocumentCreatePlan> {
  const contentKey =
    input.contentKey ?? crypto.getRandomValues(new Uint8Array(32));
  if (contentKey.byteLength !== 32) {
    throw new Error("Document content key must be 32 bytes");
  }
  const targetEnvelopes = await wrapDocumentContentKeyForCreate({
    contentKey,
    execSql: input.execSql,
    knownContainerKeks: input.knownContainerKeks,
    projection: input.containerProjection,
    secretKey: input.targetSecretKey,
    ...projectionVerificationOptions(input),
  });
  const plan = await buildDocumentCreatePlan({
    author: input.author,
    containerProjection: input.containerProjection,
    ...(input.contentKeyEpoch === undefined
      ? {}
      : { contentKeyEpoch: input.contentKeyEpoch }),
    ...(input.documentId === undefined ? {} : { documentId: input.documentId }),
    ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
    ...(input.signedAt === undefined ? {} : { signedAt: input.signedAt }),
    targetEnvelopes,
  });

  return {
    contentKey,
    plan,
  };
}

/**
 * Build the writer projection a document-create response establishes, from the
 * container projection the create was authored against plus the manifest,
 * content-key bundle, and KEK targets the server just returned. This is the
 * same material a cold `GET /documents/:id/writer-projection` would yield, so
 * seeding it lets the first read after a create resolve locally. Shared by the
 * plain document-create path and the container-with-metadata-document path,
 * whose response carries an equivalent `DocumentCreateResponse`.
 */
export function documentWriterProjectionFromCreateResponse(input: {
  containerProjection: ContainerWriterProjectionResponse;
  response: DocumentCreateResponse;
}): DocumentWriterProjectionResponse {
  return {
    authorizingContainerPaths: [input.containerProjection],
    contentKeyBundle: input.response.contentKeyBundle,
    documentId: input.response.id,
    documentKekTargets: input.response.documentKekTargets,
    documentManifest: input.response.accessManifest,
  };
}

export async function createRemoteDocument(input: {
  apiClient: DocumentCreateApi;
  author: DocumentCreateAuthor;
  containerId: string;
  contentKey?: Uint8Array | undefined;
  contentKeyEpoch?: number | undefined;
  documentId?: string | undefined;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
}): Promise<CreateRemoteDocumentResult | null> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote document create",
  );
  const containerProjection =
    await input.apiClient.getContainerWriterProjection(input.containerId);
  if (!containerProjection) {
    return null;
  }

  const materializedPlan = await buildMaterializedDocumentCreatePlan({
    author: input.author,
    containerProjection,
    contentKey: input.contentKey,
    contentKeyEpoch: input.contentKeyEpoch,
    documentId: input.documentId,
    eventId: input.eventId,
    execSql: input.execSql,
    resolveProjectionUserKey,
    signedAt: input.signedAt,
    targetSecretKey: input.targetSecretKey,
  });
  const response = await input.apiClient.createDocument(
    materializedPlan.plan.request,
  );
  if (!response) {
    return null;
  }
  const persistedState = persistedDocumentCreateStateFromResponse(
    materializedPlan.plan,
    response,
  );
  const writerProjection = documentWriterProjectionFromCreateResponse({
    containerProjection,
    response,
  });
  // Seed the projection the create response already gave us so the first read
  // after create (sync, blob attach, container-contents hydration) resolves
  // locally instead of a cold GET writer-projection.
  input.apiClient.primeDocumentWriterProjection(response.id, writerProjection);

  return {
    contentKey: materializedPlan.contentKey,
    documentId: response.id,
    persistedState,
    plan: materializedPlan.plan,
    response,
    writerProjection,
  };
}
