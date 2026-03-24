import { afterAll, expect, test } from "bun:test";
import { generateSeedAndKeyPair } from "@tearleads/crypto";
import { get } from "../adapters/redis";
import { app } from "../index";

afterAll(async () => {
  const { createClient } = await import("redis");
  const client = createClient();
  await client.connect();
  await client.del("publicKey");
  await client.quit();
});

test("POST /publicKey stores the key in redis", async () => {
  const { publicKey } = generateSeedAndKeyPair();
  const keyArray = Array.from(publicKey);

  const res = await app.request("/publicKey", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: keyArray }),
  });

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ message: "ok" });

  const stored = await get("publicKey");
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored!)).toEqual(keyArray);
});
