import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { accessEvents } from "@tearleads/api-shared/schema";
import {
  KeyingVerificationError,
  type VerifiedAccessEvent,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { canonicalJsonEquals } from "../../../utils/canonicalJson";
import { accessEventDependencyHashes } from "./accessManifestJson";
import { assertCanonicalStoredUuid } from "./canonicalStoredUuid";
import { selectOneOrThrow } from "./selectOneOrThrow";

export async function insertAccessEvent(
  verifiedEvent: VerifiedAccessEvent,
  executor: DatabaseSession,
): Promise<typeof accessEvents.$inferSelect> {
  const event = verifiedEvent.event;
  for (const field of ["objectId", "organizationId", "signerUserId"] as const) {
    assertCanonicalStoredUuid(event[field], `Access event ${field}`);
  }

  await executor
    .insert(accessEvents)
    .values({
      version: event.version,
      eventId: event.eventId,
      eventType: event.eventType,
      objectKind: event.objectKind,
      objectId: event.objectId,
      organizationId: event.organizationId,
      previousManifestHash: event.previousManifestHash,
      dependencyManifestHashes: accessEventDependencyHashes(verifiedEvent),
      bodyHash: event.bodyHash,
      body: verifiedEvent.body,
      eventHash: verifiedEvent.eventHash,
      signerUserId: event.signerUserId,
      signerDeviceId: event.signerDeviceId,
      signerKeyFingerprint: event.signerKeyFingerprint,
      signature: event.signature,
      signedAt: new Date(event.signedAt),
    })
    .onConflictDoNothing({ target: accessEvents.eventHash });

  // Compare the representation readers will reconstruct, including on first
  // insertion. Verification before storage cannot authenticate normalized data.
  return ensureStoredAccessEventMatches(verifiedEvent, executor);
}

async function ensureStoredAccessEventMatches(
  verifiedEvent: VerifiedAccessEvent,
  executor: DatabaseSession,
): Promise<typeof accessEvents.$inferSelect> {
  const storedEvent = await selectOneOrThrow(
    executor
      .select()
      .from(accessEvents)
      .where(eq(accessEvents.eventHash, verifiedEvent.eventHash))
      .limit(1),
    "Failed to load stored access event",
  );

  const event = verifiedEvent.event;
  if (
    storedEvent.version !== event.version ||
    storedEvent.eventId !== event.eventId ||
    storedEvent.eventType !== event.eventType ||
    storedEvent.objectKind !== event.objectKind ||
    storedEvent.objectId !== event.objectId ||
    storedEvent.organizationId !== event.organizationId ||
    storedEvent.previousManifestHash !== event.previousManifestHash ||
    !canonicalJsonEquals(
      storedEvent.dependencyManifestHashes,
      accessEventDependencyHashes(verifiedEvent),
    ) ||
    storedEvent.bodyHash !== event.bodyHash ||
    !canonicalJsonEquals(storedEvent.body, verifiedEvent.body) ||
    storedEvent.signerUserId !== event.signerUserId ||
    storedEvent.signerDeviceId !== event.signerDeviceId ||
    storedEvent.signerKeyFingerprint !== event.signerKeyFingerprint ||
    storedEvent.signature !== event.signature ||
    storedEvent.signedAt.toISOString() !== event.signedAt
  ) {
    throw new KeyingVerificationError(
      "invalid_shape",
      "Stored access event does not preserve the verified event verbatim",
    );
  }
  return storedEvent;
}
