import { afterAll, expect, test } from "bun:test";
import { generateSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import invariant from "invariant";
import { get } from "../adapters/redis";
import { app } from "../index";

let fingerprint: string;

afterAll(async () => {
  const { createClient } = await import("redis");
  const client = createClient();
  await client.connect();
  await client.del(fingerprint);
  await client.quit();
});

test("POST /publicKey stores the key in redis keyed by fingerprint", async () => {
  const { publicKey } = generateSeedAndKeyPair();
  const keyArray = Array.from(publicKey);
  fingerprint = await toFingerprint(publicKey);

  const res = await app.request("/publicKey", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: keyArray }),
  });

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ message: "ok" });

  const stored = await get(fingerprint);
  invariant(stored, "expected publicKey to be stored in redis by fingerprint");
  expect(JSON.parse(stored)).toEqual(keyArray);
});
