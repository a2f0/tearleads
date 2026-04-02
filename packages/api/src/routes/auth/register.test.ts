import { afterAll, expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { uploadKey } from "../../../test/helpers/api";
import { db } from "../../adapters/postgres";
import { del, get } from "../../adapters/redis";
import { app } from "../../index";
import { containers, organizations, users } from "../../schema";

let fingerprint: string;

function decodeKey(value: string): number[] {
  return Array.from(base64ToBytes(value));
}

afterAll(async () => {
  await del(fingerprint);
});

test("POST /auth/register stores the key in redis keyed by fingerprint", async () => {
  const { signingPublicKey } = generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  const keyArray = Array.from(signingPublicKey);
  fingerprint = await toFingerprint(signingPublicKey);

  const res = await uploadKey(signingPublicKey, publicKey);

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.message).toBe("ok");
  expect(typeof body.userId).toBe("string");
  expect(body.userId.length).toBeGreaterThan(0);

  const stored = await get(fingerprint);
  invariant(stored, "expected publicKey to be stored in redis by fingerprint");
  expect(decodeKey(stored)).toEqual(keyArray);
});

test("POST /auth/register creates a user in postgres", async () => {
  const { signingPublicKey } = generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  const keyArray = Array.from(signingPublicKey);
  fingerprint = await toFingerprint(signingPublicKey);

  const res = await uploadKey(signingPublicKey, publicKey);
  expect(res.status).toBe(200);
  const body = await res.json();

  const [user] = await db.select().from(users).where(eq(users.id, body.userId));

  invariant(user, "expected user to exist in postgres");
  expect(user.fingerprint).toBe(fingerprint);
  expect(decodeKey(user.signingPublicKey)).toEqual(keyArray);
});

test("POST /auth/register returns 409 when key already exists", async () => {
  const { signingPublicKey } = generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  fingerprint = await toFingerprint(signingPublicKey);

  const first = await uploadKey(signingPublicKey, publicKey);
  expect(first.status).toBe(200);

  const second = await uploadKey(signingPublicKey, publicKey);
  expect(second.status).toBe(409);
  expect(await second.json()).toEqual({ error: "Key already exists" });
});

test("POST /auth/register rolls back organization and container rows on duplicate fingerprint", async () => {
  const { signingPublicKey } = generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();

  const countOrganizations = async () =>
    (await db.select().from(organizations)).length;
  const countContainers = async () =>
    (await db.select().from(containers)).length;

  const organizationsBefore = await countOrganizations();
  const containersBefore = await countContainers();

  const first = await uploadKey(signingPublicKey, publicKey);
  expect(first.status).toBe(200);

  const organizationsAfterFirst = await countOrganizations();
  const containersAfterFirst = await countContainers();
  expect(organizationsAfterFirst).toBe(organizationsBefore + 1);
  expect(containersAfterFirst).toBe(containersBefore + 1);

  const second = await uploadKey(signingPublicKey, publicKey);
  expect(second.status).toBe(409);

  expect(await countOrganizations()).toBe(organizationsAfterFirst);
  expect(await countContainers()).toBe(containersAfterFirst);
});

test("POST /auth/register rejects a wrapped envelope whose fingerprint does not match the encapsulation key", async () => {
  const { signingPublicKey } = generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  const recipients = await wrapDekForRecipients(
    crypto.getRandomValues(new Uint8Array(32)),
    [publicKey],
  );
  const wrappedEnvelope = recipients[0];
  invariant(wrappedEnvelope, "expected a wrapped envelope");

  const response = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      signingPublicKey: Array.from(signingPublicKey),
      encapsulationPublicKey: Array.from(publicKey),
      wrappedDekEnvelope: {
        keyFingerprint: "mismatch",
        kemCipherText: Array.from(wrappedEnvelope.kemCipherText),
        wrappedKey: Array.from(wrappedEnvelope.wrappedKey),
      },
    }),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error:
      "wrappedDekEnvelope.keyFingerprint does not match encapsulationPublicKey",
  });
});

test("POST /auth/register rejects malformed wrapped envelope lengths", async () => {
  const { signingPublicKey } = generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  const recipients = await wrapDekForRecipients(
    crypto.getRandomValues(new Uint8Array(32)),
    [publicKey],
  );
  const wrappedEnvelope = recipients[0];
  invariant(wrappedEnvelope, "expected a wrapped envelope");

  const badKemCipherText = Array.from(
    wrappedEnvelope.kemCipherText.slice(0, 8),
  );
  const response = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      signingPublicKey: Array.from(signingPublicKey),
      encapsulationPublicKey: Array.from(publicKey),
      wrappedDekEnvelope: {
        keyFingerprint: wrappedEnvelope.keyFingerprint,
        kemCipherText: badKemCipherText,
        wrappedKey: Array.from(wrappedEnvelope.wrappedKey),
      },
    }),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Invalid wrappedDekEnvelope.kemCipherText length",
  });
});
