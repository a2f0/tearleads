import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { accessEvents } from "@tearleads/api-shared/schema";
import type {
  AccessEventType,
  AccessObjectKind,
  VerifiedAccessEvent,
} from "@tearleads/crypto";
import { makeVerifiedAccessEvent } from "@tearleads/crypto";
import { and, eq, inArray } from "drizzle-orm";
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

export async function getStoredAccessEventByObjectType(input: {
  readonly eventType: AccessEventType;
  readonly executor: DatabaseSession;
  readonly objectId: string;
  readonly objectKind: AccessObjectKind;
}): Promise<VerifiedAccessEvent | null> {
  const rows = await input.executor
    .select()
    .from(accessEvents)
    .where(
      and(
        eq(accessEvents.eventType, input.eventType),
        eq(accessEvents.objectKind, input.objectKind),
        eq(accessEvents.objectId, input.objectId),
      ),
    )
    .limit(2);
  if (rows.length > 1) {
    throw new Error("Stored access event type is not unique for its object");
  }
  const [row] = rows;
  return row ? toStoredAccessEvent(row) : null;
}
