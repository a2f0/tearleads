import { afterAll, expect, test } from "bun:test";
import { generateSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import invariant from "invariant";
import { uploadKey } from "../../../test/helpers/api";
import { del, get } from "../../adapters/redis";

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
  expect(await res.json()).toEqual({ message: "ok" });

  const stored = await get(fingerprint);
  invariant(stored, "expected publicKey to be stored in redis by fingerprint");
  expect(JSON.parse(stored)).toEqual(keyArray);
});
