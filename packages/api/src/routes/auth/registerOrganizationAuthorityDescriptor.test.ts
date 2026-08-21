import { afterAll, expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@symcrypt/crypto";
import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import { createRegistrationRequestBody } from "../../../test/helpers/api";
import { del } from "../../adapters/redis";
import { routeApp } from "../../routeApp";

let fingerprint: string | undefined;

afterAll(async () => {
  if (fingerprint) {
    await del(fingerprint);
  }
});

test("POST /auth/register rejects an authority descriptor for other reserved groups", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  fingerprint = await toFingerprint(signingPublicKey);
  const body = await createRegistrationRequestBody(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );
  const descriptor = JSON.parse(
    new TextDecoder().decode(
      base64ToBytes(body.initialOrganizationPolicy.encryptedPayload.ciphertext),
    ),
  ) as Record<string, unknown>;

  const response = await routeApp.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      initialOrganizationPolicy: {
        ...body.initialOrganizationPolicy,
        encryptedPayload: {
          ...body.initialOrganizationPolicy.encryptedPayload,
          ciphertext: bytesToBase64(
            new TextEncoder().encode(
              JSON.stringify({
                ...descriptor,
                adminGroupId: crypto.randomUUID(),
              }),
            ),
          ),
        },
      },
    }),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error:
      "initialOrganizationPolicy authority descriptor must bind the reserved groups",
  });
});

test("POST /auth/register rejects organization policies with container grants", async () => {
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
        grants: [
          {
            accessLevel: "admin",
            containerId: body.rootContainerId,
          },
        ],
      },
    }),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "initialOrganizationPolicy cannot contain container grants",
  });
});
