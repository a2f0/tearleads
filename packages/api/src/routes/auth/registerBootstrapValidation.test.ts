import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import invariant from "invariant";
import { createRegistrationRequestBody } from "../../../test/helpers/api";
import { routeApp } from "../../routeApp";

test("POST /auth/register rejects initial org policies that do not bootstrap the registering user as sole admin", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  const body = await createRegistrationRequestBody(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );
  const onlyProjectionMember = body.initialOrganizationPolicy.projection[0];
  invariant(onlyProjectionMember, "expected initial org projection member");

  const response = await routeApp.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      initialOrganizationPolicy: {
        ...body.initialOrganizationPolicy,
        projection: [
          {
            ...onlyProjectionMember,
            role: "member",
          },
        ],
      },
    }),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error:
      "initialOrganizationPolicy projection must contain the registering user as sole admin",
  });
});

test("POST /auth/register rejects malformed initial root container event records", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
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
      initialRootContainer: {
        ...body.initialRootContainer,
        event: {
          ...body.initialRootContainer.event,
          version: "2",
        },
      },
    }),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Initial root container event.version is invalid",
  });
});

test("POST /auth/register rejects malformed initial root container KEK records", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
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
      initialRootContainer: {
        ...body.initialRootContainer,
        keyEpoch: {
          ...body.initialRootContainer.keyEpoch,
          keyEpoch: "1",
        },
      },
    }),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Initial root container key epoch.keyEpoch is invalid",
  });
});

test("POST /auth/register rejects missing initial root user recipient keys", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  const body = await createRegistrationRequestBody(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );
  const initialRootContainer = { ...body.initialRootContainer };
  delete initialRootContainer.userRecipientKeys;

  const response = await routeApp.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      initialRootContainer,
    }),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Initial root container user recipient keys is invalid",
  });
});
