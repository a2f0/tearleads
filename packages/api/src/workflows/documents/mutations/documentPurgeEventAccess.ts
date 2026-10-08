import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  normalizeDocumentPurgeAccessEventBody,
  type VerifiedAccessEvent,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { getStoredAccessEventByObjectType } from "../../../access/read/accessManifestStore";
import { keyingVerificationHttpStatus } from "../../../keyingProjectionRecords";
import { loadSignerPublicKey } from "../../signerPublicKey";
import { authorizeDocumentPurgeProof } from "./documentPurgeProofAuthorization";
import { DocumentMutationError } from "./errors";

async function verifyStoredPurgeEvent(input: {
  readonly documentId: string;
  readonly event: VerifiedAccessEvent;
  readonly executor: DatabaseSession;
}): Promise<VerifiedAccessEvent> {
  const signerPublicKey = await loadSignerPublicKey(input.executor, {
    error: (message, status) => new DocumentMutationError(message, status),
    fingerprint: input.event.event.signerKeyFingerprint,
    userId: input.event.event.signerUserId,
  });
  const verified = await verifySignedAccessEvent({
    body: input.event.body,
    event: input.event.event,
    signerPublicKey,
  });
  if (!verified.ok) {
    throw new DocumentMutationError(
      verified.error.message,
      keyingVerificationHttpStatus(verified.error),
    );
  }
  if (
    verified.value.eventHash !== input.event.eventHash ||
    verified.value.event.objectId !== input.documentId ||
    verified.value.event.eventType !== "document.purge"
  ) {
    throw new DocumentMutationError(
      "Stored document purge event is inconsistent",
      409,
    );
  }
  return verified.value;
}

function readStoredPurgeReference(event: VerifiedAccessEvent) {
  const body = normalizeDocumentPurgeAccessEventBody(event.body);
  const documentManifestHash = event.event.previousManifestHash;
  if (
    documentManifestHash === null ||
    documentManifestHash !== body.documentManifestHash
  ) {
    throw new DocumentMutationError(
      "Stored document purge predecessor is inconsistent",
      409,
    );
  }
  return { body, documentManifestHash };
}

/** Reauthorize terminal history against the signed purge path on every read. */
export async function loadAuthorizedDocumentPurgeEvent(input: {
  readonly documentId: string;
  readonly executor: DatabaseSession;
  readonly userId: string;
  readonly documentCheckpointManifestHash?: string | undefined;
}) {
  const storedEvent = await getStoredAccessEventByObjectType({
    eventType: "document.purge",
    executor: input.executor,
    objectId: input.documentId,
    objectKind: "document",
  });
  if (!storedEvent)
    throw new DocumentMutationError("Document purge proof not found", 404);
  const event = await verifyStoredPurgeEvent({ ...input, event: storedEvent });
  const { body, documentManifestHash } = readStoredPurgeReference(event);
  const authorizationMaterial = await authorizeDocumentPurgeProof({
    ...input,
    body,
    checkpointManifestHash: input.documentCheckpointManifestHash,
  });
  return { event, body, documentManifestHash, authorizationMaterial };
}
