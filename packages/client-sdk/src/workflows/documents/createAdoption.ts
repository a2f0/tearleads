import type {
  VerifiedContainerAccessManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  assertDocumentWriterProjectionConsistent,
  readLinkedContainerIdsFromDocumentManifest,
  unwrapDocumentContentKeyFromWriterProjection,
} from "../../data/documents/shared/projection";
import { persistedDocumentCreateStateFromWriterProjection } from "../../data/documents/shared/responses";
import type {
  CreateRemoteDocumentResult,
  DocumentCreateApi,
  ProjectionVerificationOptions,
} from "../../data/documents/shared/types";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

type RemoteDocumentAdoptionInput = {
  readonly apiClient: DocumentCreateApi;
  readonly documentId: string;
  readonly execSql: ExecSql;
  readonly expectedContainerId: string;
  readonly expectedOrganizationId: string;
  readonly targetSecretKey: Uint8Array;
} & ProjectionVerificationOptions;

function assertExpectedAdoptionScope(
  input: RemoteDocumentAdoptionInput,
  writerProjection: DocumentWriterProjectionResponse,
): void {
  const linkedContainerIds =
    readLinkedContainerIdsFromDocumentManifest(writerProjection);
  const expectedPath = writerProjection.authorizingContainerPaths.find(
    (projection) =>
      projection.containerId === input.expectedContainerId &&
      projection.organizationId === input.expectedOrganizationId,
  );
  if (
    linkedContainerIds.length !== 1 ||
    linkedContainerIds[0] !== input.expectedContainerId ||
    !expectedPath
  ) {
    throw new Error(
      "Document create conflict belongs to another container or organization",
    );
  }
}

/** Recover a committed retry only when it belongs to the intended org scope. */
export async function adoptExistingRemoteDocument(
  input: RemoteDocumentAdoptionInput,
): Promise<CreateRemoteDocumentResult | null> {
  if (!input.apiClient.getDocumentWriterProjection) return null;
  const writerProjection = await input.apiClient.getDocumentWriterProjection(
    input.documentId,
  );
  if (!writerProjection) return null;

  // Reject a foreign collision before verification can pin its checkpoints.
  assertExpectedAdoptionScope(input, writerProjection);
  const verifiedByHash = new Map<string, VerifiedContainerAccessManifest>();
  const principalPolicyCache = new Map<string, VerifiedPrincipalPolicy>();
  const targets = await assertDocumentWriterProjectionConsistent(
    writerProjection,
    {
      execSql: input.execSql,
      principalPolicyCache,
      verifiedByHash,
      ...projectionVerificationOptions(input),
    },
  );
  if (
    targets.length !== 1 ||
    targets[0]?.containerId !== input.expectedContainerId
  ) {
    throw new Error(
      "Document create conflict belongs to another container or organization",
    );
  }
  const contentKey = await unwrapDocumentContentKeyFromWriterProjection({
    execSql: input.execSql,
    principalPolicyCache,
    secretKey: input.targetSecretKey,
    verifiedByHash,
    writerProjection,
    ...projectionVerificationOptions(input),
  });
  input.apiClient.primeDocumentWriterProjection(
    writerProjection.documentId,
    writerProjection,
  );
  return {
    contentKey,
    documentId: writerProjection.documentId,
    persistedState:
      persistedDocumentCreateStateFromWriterProjection(writerProjection),
    writerProjection,
  };
}
