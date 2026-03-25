import { afterAll, expect, test } from "bun:test";
import { generateSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { uploadKey } from "../../../test/helpers/api";
import { db } from "../../adapters/postgres";
import { del, get } from "../../adapters/redis";
import { users } from "../../schema";

let fingerprint: string;

afterAll(async () => {
  await del(fingerprint);
});

test("POST /auth/register stores the key in redis keyed by fingerprint", async () => {
  const { publicKey } = generateSeedAndKeyPair();
  const keyArray = Array.from(publicKey);
  fingerprint = await toFingerprint(publicKey);

  const res = await uploadKey(publicKey);

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.message).toBe("ok");
  expect(typeof body.userId).toBe("string");
  expect(body.userId.length).toBeGreaterThan(0);

  const stored = await get(fingerprint);
  invariant(stored, "expected publicKey to be stored in redis by fingerprint");
  expect(Array.from(Buffer.from(stored, "base64"))).toEqual(keyArray);
});

test("POST /auth/register creates a user in postgres", async () => {
  const { publicKey } = generateSeedAndKeyPair();
  const keyArray = Array.from(publicKey);
  fingerprint = await toFingerprint(publicKey);

  const res = await uploadKey(publicKey);
  expect(res.status).toBe(200);
  const body = await res.json();

  const [user] = await db.select().from(users).where(eq(users.id, body.userId));

  invariant(user, "expected user to exist in postgres");
  expect(user.fingerprint).toBe(fingerprint);
  expect(Array.from(Buffer.from(user.publicKey, "base64"))).toEqual(keyArray);
});

test("POST /auth/register returns 409 when key already exists", async () => {
  const { publicKey } = generateSeedAndKeyPair();
  fingerprint = await toFingerprint(publicKey);

  const first = await uploadKey(publicKey);
  expect(first.status).toBe(200);

  const second = await uploadKey(publicKey);
  expect(second.status).toBe(409);
  expect(await second.json()).toEqual({ error: "Key already exists" });
});
