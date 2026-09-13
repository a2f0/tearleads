import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
  type VerifiedPrincipalPolicy,
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
import {
  readAccessEvent,
  readAccessManifest,
} from "../../data/keyingProjectionVerification/readers";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

type RemoteDocumentAdoptionInput = {
  readonly apiClient: DocumentCreateApi;
  readonly documentId: string;
  readonly execSql: ExecSql;
  readonly expectedContainerId: string;
  readonly expectedOrganizationId: string;
  /** The local user whose pending create the retry is recovering. */
  readonly expectedSignerUserId: string;
  readonly targetSecretKey: Uint8Array;
} & ProjectionVerificationOptions;

/**
 * A retry after a lost create response can only recover the local user's own
 * create: the server serves whatever document holds the stable id we minted,
 * and an honest server only ever committed ours under it. A create event signed
 * by anyone else is a foreign document colliding on that id (a member with
 * write access on the same container, or a dishonest server), which must not be
 * adopted as if it were the pending local write.
 *
 * The create event is located by walking the served head's predecessor chain,
 * not by scanning the history for any parentless manifest: the history is
 * server-supplied, so a dishonest server could splice in a genesis this user
 * signed for a different document. Every manifest on the chain must also name
 * the requested document.
 */
function assertCreateEventSignedLocally(
  input: RemoteDocumentAdoptionInput,
  writerProjection: DocumentWriterProjectionResponse,
): void {
  const label = "Document create conflict";
  const historyByHash = new Map(
    writerProjection.documentManifestHistory.map((bundle) => [
      bundle.manifestHash,
      bundle,
    ]),
  );
  const visited = new Set<string>();
  let bundle = writerProjection.documentManifest;
  for (;;) {
    const manifest = readAccessManifest(bundle.manifest, `${label} manifest`);
    if (
      manifest.objectKind !== "document" ||
      manifest.objectId !== input.documentId
    ) {
      throw new KeyingVerificationError(
        "object_mismatch",
        `${label} manifest chain names another document`,
      );
    }
    if (manifest.previousManifestHash === null) {
      const createEvent = readAccessEvent(
        bundle.event.event,
        `${label} create event`,
      );
      if (createEvent.signerUserId !== input.expectedSignerUserId) {
        throw new KeyingVerificationError(
          "signer_mismatch",
          `${label} create event was signed by another user`,
        );
      }
      return;
    }
    if (visited.has(bundle.manifestHash)) {
      throw new Error(`${label} manifest history is cyclic`);
    }
    visited.add(bundle.manifestHash);
    const previous = historyByHash.get(manifest.previousManifestHash);
    if (!previous) {
      throw new Error(`${label} does not expose its create event`);
    }
    bundle = previous;
  }
}

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
  const writerProjection = await input.apiClient.getDocumentWriterProjection(
    input.documentId,
  );
  if (!writerProjection) return null;

  // Reject a foreign collision before verification can pin its checkpoints.
  assertExpectedAdoptionScope(input, writerProjection);
  assertCreateEventSignedLocally(input, writerProjection);
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
  if (input.stillCurrent?.() === false) return null;
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
