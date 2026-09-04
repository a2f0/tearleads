import { afterAll, expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
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

test.each([
  "initialAdminGroup",
  "initialMemberGroup",
] as const)("POST /auth/register binds the reserved %s name to its signed payload", async (groupField) => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  const body = await createRegistrationRequestBody(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );
  const group = body[groupField];
  const response = await routeApp.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      [groupField]: {
        ...group,
        initialGroupPolicy: {
          ...group.initialGroupPolicy,
          encryptedPayload: {
            ...group.initialGroupPolicy.encryptedPayload,
            ciphertext: bytesToBase64(
              new TextEncoder().encode(JSON.stringify({ name: "Other" })),
            ),
          },
        },
      },
    }),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Group name must match the signed policy display name",
  });
});
