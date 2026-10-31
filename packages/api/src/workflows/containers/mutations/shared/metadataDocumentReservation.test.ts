import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestHeads,
} from "@tearleads/api-shared/schema";
import { assertMetadataDocumentAvailable } from "./metadataDocumentReservation";

async function insertPurgeEvent(documentId: string): Promise<void> {
  await db.insert(accessEvents).values({
    version: 1,
    eventId: crypto.randomUUID(),
    eventType: "document.purge",
    objectKind: "document",
    objectId: documentId,
    organizationId: crypto.randomUUID(),
    previousManifestHash: null,
    dependencyManifestHashes: [],
    bodyHash: "body-hash",
    body: {},
    eventHash: `purge-${crypto.randomUUID()}`,
    signerUserId: crypto.randomUUID(),
    signerDeviceId: "device",
    signerKeyFingerprint: "fingerprint",
    signature: "signature",
    signedAt: new Date(),
  });
}

async function insertHead(documentId: string): Promise<void> {
  await db.insert(accessManifestHeads).values({
    objectKind: "document",
    objectId: documentId,
    organizationId: crypto.randomUUID(),
    epoch: 1,
    manifestHash: `head-${crypto.randomUUID()}`,
  });
}

const check = (documentId: string) =>
  db
    .transaction((tx) => assertMetadataDocumentAvailable(tx, documentId))
    .then(
      () => "available",
      (error: unknown) =>
        error instanceof Error ? error.message : String(error),
    );

test("the one-statement reservation check keeps its refusals and their order", async () => {
  const unused = crypto.randomUUID();
  expect(await check(unused)).toBe("available");

  const headOnly = crypto.randomUUID();
  await insertHead(headOnly);
  expect(await check(headOnly)).toBe(
    "Container metadata document already exists",
  );

  // A purge refuses before any other evidence of the same id.
  const purged = crypto.randomUUID();
  await insertHead(purged);
  await insertPurgeEvent(purged);
  expect(await check(purged)).toBe(
    "Container metadata document was permanently purged",
  );

  // More than one terminal purge event is corruption, not a reservation.
  await insertPurgeEvent(purged);
  expect(await check(purged)).toBe(
    "Stored access event type is not unique for its object",
  );
});
