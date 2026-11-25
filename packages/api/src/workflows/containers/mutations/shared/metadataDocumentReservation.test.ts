import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestHeads,
  purgedObjectReservations,
  users,
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

async function insertUser(): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    fingerprint: `fingerprint-${id}`,
    signingPublicKey: "signing",
    encapsulationPublicKey: "encapsulation",
    encapsulationKeyFingerprint: `encapsulation-${id}`,
    defaultOrganizationId: crypto.randomUUID(),
  });
  return id;
}

const requesterUserId: string = crypto.randomUUID();

const check = (documentId: string, userId = requesterUserId) =>
  db
    .transaction((tx) =>
      assertMetadataDocumentAvailable(tx, documentId, userId),
    )
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

test("an id an organization purge reserved binds only for its owner", async () => {
  const owner = await insertUser();
  const reserved = crypto.randomUUID();
  await db.insert(purgedObjectReservations).values({
    objectKind: "document",
    objectId: reserved,
    ownerUserId: owner,
    purgedOrganizationId: crypto.randomUUID(),
  });

  expect(await check(reserved)).toBe(
    "Document ID is reserved for its purged organization's recovery",
  );
  expect(await check(reserved, owner)).toBe("available");
});
