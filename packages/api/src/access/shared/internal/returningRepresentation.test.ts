import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  principalEpochKeys,
  principalStatePayloads,
  principalStates,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  principalEpochKeySelect,
  principalStatePayloadSelect,
  principalStateSelect,
} from "./principalStateRecords";

// Writers verify the stored representation from an insert's RETURNING row
// instead of selecting it back. That is sound only while RETURNING yields what
// a later read reconstructs on every dialect: jsonb key order and
// normalization, unicode, floats, and timestamp precision included.
const awkwardJson = {
  zeta: "z",
  alpha: { nested: [3, 1.5, -0.25, 1e21], ünï: "☃ é" },
  "😀": null,
  empty: {},
};
const signedAt = new Date("2026-10-30T12:34:56.789Z");

test("an access event's RETURNING row equals its read-back", async () => {
  const eventHash = `returning-probe-${crypto.randomUUID()}`;
  const values = {
    version: 1,
    eventId: crypto.randomUUID(),
    eventType: "document.link",
    objectKind: "document",
    objectId: crypto.randomUUID(),
    organizationId: crypto.randomUUID(),
    previousManifestHash: null,
    dependencyManifestHashes: ["b-hash", "a-hash"],
    bodyHash: "body-hash",
    body: awkwardJson,
    eventHash,
    signerUserId: crypto.randomUUID(),
    signerDeviceId: "device",
    signerKeyFingerprint: "fingerprint",
    signature: "signature",
    signedAt,
  } satisfies typeof accessEvents.$inferInsert;
  const insert = () =>
    db
      .insert(accessEvents)
      .values({ ...values, eventId: crypto.randomUUID() })
      .onConflictDoNothing({ target: accessEvents.eventHash })
      .returning();
  const [inserted] = await insert();
  const [read] = await db
    .select()
    .from(accessEvents)
    .where(eq(accessEvents.eventHash, eventHash));
  expect(inserted).toBeDefined();
  expect(inserted).toEqual(read);
  expect(Object.keys(inserted?.body ?? {})).toEqual(
    Object.keys(read?.body ?? {}),
  );

  // The conflict branch returns no row, so writers keep the read-back there.
  expect(await insert()).toEqual([]);
});

test("principal state rows' RETURNING rows equal their read-backs", async () => {
  const principalId = crypto.randomUUID();
  const stateHash = `returning-probe-${crypto.randomUUID()}`;
  const [insertedState] = await db
    .insert(principalStates)
    .values({
      principalType: "group",
      principalId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: "public-key",
      keyFingerprint: "key-fingerprint",
      membershipMode: "projection",
      membershipRoot: "membership-root",
      memberEnvelopesRoot: "envelopes-root",
      projectionRoot: "projection-root",
      grantRoot: "grant-root",
      payloadCiphertextHash: "payload-hash",
      memberCount: 1,
      grantCount: 2,
      containerGrants: [
        { containerId: "b", accessLevel: "write" },
        { accessLevel: "read", containerId: "a" },
      ],
      // Any JSON object: this probes the column, not the signed type.
      externalAuthority: JSON.parse(JSON.stringify(awkwardJson)),
      stateHash,
      signedAt,
      signerUserId: crypto.randomUUID(),
      signerUserKeyFingerprint: "signer-fingerprint",
      signature: "signature",
    })
    .returning({
      ...principalStateSelect,
      containerGrants: principalStates.containerGrants,
    });
  const [readState] = await db
    .select({
      ...principalStateSelect,
      containerGrants: principalStates.containerGrants,
    })
    .from(principalStates)
    .where(eq(principalStates.stateHash, stateHash));
  expect(insertedState).toBeDefined();
  expect(insertedState).toEqual(readState);
  expect(JSON.stringify(insertedState?.externalAuthority)).toBe(
    JSON.stringify(readState?.externalAuthority),
  );
  expect(JSON.stringify(insertedState?.containerGrants)).toBe(
    JSON.stringify(readState?.containerGrants),
  );

  const [insertedPayload] = await db
    .insert(principalStatePayloads)
    .values({
      principalType: "group",
      principalId,
      stateHash,
      cipherSuite: "aes-256-gcm",
      ciphertext: "ciphertext ☃",
      ciphertextHash: "ciphertext-hash",
    })
    .returning(principalStatePayloadSelect);
  const [readPayload] = await db
    .select(principalStatePayloadSelect)
    .from(principalStatePayloads)
    .where(eq(principalStatePayloads.stateHash, stateHash));
  expect(insertedPayload).toBeDefined();
  expect(insertedPayload).toEqual(readPayload);

  const [insertedKey] = await db
    .insert(principalEpochKeys)
    .values({
      principalType: "group",
      principalId,
      epoch: 1,
      introducedByStateHash: stateHash,
      encapsulationPublicKey: "public-key",
      keyFingerprint: "key-fingerprint",
    })
    .returning(principalEpochKeySelect);
  const [readKey] = await db
    .select(principalEpochKeySelect)
    .from(principalEpochKeys)
    .where(eq(principalEpochKeys.principalId, principalId));
  expect(insertedKey).toBeDefined();
  expect(insertedKey).toEqual(readKey);
});
