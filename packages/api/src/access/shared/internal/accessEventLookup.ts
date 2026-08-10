import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { accessEvents } from "@tearleads/api-shared/schema";
import type { VerifiedAccessEvent } from "@tearleads/crypto";
import { makeVerifiedAccessEvent } from "@tearleads/crypto";
import { inArray } from "drizzle-orm";
import { readKeyingCanonicalJson } from "../../../utils/canonicalJson";
import {
  isString,
  readAccessVersion,
  readJsonArray,
} from "./accessManifestJson";

export function toStoredAccessEvent(
  row: typeof accessEvents.$inferSelect,
): VerifiedAccessEvent {
  return makeVerifiedAccessEvent({
    event: {
      version: readAccessVersion(row.version, "stored access event"),
      eventId: row.eventId,
      eventType: row.eventType,
      objectKind: row.objectKind,
      objectId: row.objectId,
      organizationId: row.organizationId,
      previousManifestHash: row.previousManifestHash,
      dependencyManifestHashes: readJsonArray<string>(
        row.dependencyManifestHashes,
        "access event dependency hashes",
        isString,
      ),
      bodyHash: row.bodyHash,
      signerUserId: row.signerUserId,
      signerDeviceId: row.signerDeviceId,
      signerKeyFingerprint: row.signerKeyFingerprint,
      signedAt: row.signedAt.toISOString(),
      signature: row.signature,
    },
    body: readKeyingCanonicalJson(row.body, "stored access event body"),
    eventHash: row.eventHash,
  });
}

export async function getStoredAccessEvents(
  eventHashes: readonly string[],
  executor: DatabaseSession,
): Promise<Map<string, VerifiedAccessEvent>> {
  const uniqueHashes = [...new Set(eventHashes)];
  if (uniqueHashes.length === 0) {
    return new Map();
  }
  const events = await executor
    .select()
    .from(accessEvents)
    .where(inArray(accessEvents.eventHash, uniqueHashes));
  return new Map(
    events.map((event) => [event.eventHash, toStoredAccessEvent(event)]),
  );
}
