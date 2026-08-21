import { afterAll, expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
import { createRegistrationRequestBody } from "../../../test/helpers/api";
import { del } from "../../adapters/redis";
import { routeApp } from "../../routeApp";

let fingerprint: string;

afterAll(async () => {
  await del(fingerprint);
});

test("POST /auth/register preserves principal policy authorization errors", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  fingerprint = await toFingerprint(signingPublicKey);
  const body = await createRegistrationRequestBody(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );

  const response = await routeApp.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      initialOrganizationPolicy: {
        ...body.initialOrganizationPolicy,
        state: {
          ...body.initialOrganizationPolicy.state,
          signature: bytesToBase64(new Uint8Array(64)),
        },
      },
    }),
  });

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "Invalid principal state signature",
  });
});
