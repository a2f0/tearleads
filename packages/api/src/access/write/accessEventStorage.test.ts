import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { accessEvents } from "@tearleads/api-shared/schema";
import {
  computeAccessEventBodyHash,
  generateSigningSeedAndKeyPair,
  type KeyingCanonicalJson,
  signAccessEvent,
  toFingerprint,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { getStoredAccessEvents } from "../read/accessManifestStore";
import { storeVerifiedAccessEventInTransaction } from "./accessManifestStore";

async function signedEvent(input: {
  objectId?: string;
  organizationId?: string;
  signerUserId?: string;
  body?: KeyingCanonicalJson;
  signerDeviceId?: string;
}) {
  const signing = generateSigningSeedAndKeyPair();
  const body = input.body ?? { eventType: "container.create" };
  const event = await signAccessEvent(
    {
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: "container.create",
      objectKind: "container",
      objectId: input.objectId ?? crypto.randomUUID(),
      organizationId: input.organizationId ?? crypto.randomUUID(),
      signerUserId: input.signerUserId ?? crypto.randomUUID(),
      signerDeviceId: input.signerDeviceId ?? "device-1",
      signerKeyFingerprint: await toFingerprint(signing.signingPublicKey),
      signedAt: "2026-09-25T00:00:00.000Z",
      previousManifestHash: null,
      dependencyManifestHashes: [],
      bodyHash: await computeAccessEventBodyHash(body),
    },
    signing.signingPrivateKey,
  );
  const verified = await verifySignedAccessEvent({
    body,
    event,
    signerPublicKey: signing.signingPublicKey,
  });
  if (!verified.ok) throw verified.error;
  return { signing, verified: verified.value };
}

test("stored access events preserve valid Unicode and signatures exactly", async () => {
  const { signing, verified } = await signedEvent({
    signerDeviceId: "device-😀-e\u0301",
    body: { value: "\u00e9 differs from e\u0301" },
  });
  await db.transaction((tx) =>
    storeVerifiedAccessEventInTransaction(verified, tx),
  );
  const stored = (await getStoredAccessEvents([verified.eventHash], db)).get(
    verified.eventHash,
  );
  expect(stored).toEqual(verified);
  if (!stored) throw new Error("Missing stored event");
  expect(
    (
      await verifySignedAccessEvent({
        body: stored.body,
        event: stored.event,
        signerPublicKey: signing.signingPublicKey,
      })
    ).ok,
  ).toBe(true);
});

test("UUID columns cannot normalize signed event identities", async () => {
  for (const field of ["objectId", "organizationId", "signerUserId"] as const) {
    const { verified } = await signedEvent({
      [field]: "A2345678-1234-4567-89AB-123456789ABC",
    });
    await expect(
      db.transaction((tx) =>
        storeVerifiedAccessEventInTransaction(verified, tx),
      ),
    ).rejects.toMatchObject({ code: "invalid_shape" });
    expect(
      await db
        .select()
        .from(accessEvents)
        .where(eq(accessEvents.eventHash, verified.eventHash)),
    ).toHaveLength(0);
  }
});
