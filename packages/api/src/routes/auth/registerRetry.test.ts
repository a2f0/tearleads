import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containers, organizations, users } from "@tearleads/api-shared/schema";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import type { RegistrationRequest } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import { createRegistrationRequestBody } from "../../../test/helpers/api";
import { routeApp } from "../../routeApp";

function register(body: RegistrationRequest) {
  return routeApp.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("registration retries reject the existing key before reusing its root", async () => {
  const signing = generateSigningSeedAndKeyPair();
  const kem = generateKemSeedAndKeyPair();
  const first = await createRegistrationRequestBody(
    signing.signingPublicKey,
    signing.signingPrivateKey,
    kem.publicKey,
  );
  expect((await register(first)).status).toBe(200);

  const retry = await createRegistrationRequestBody(
    signing.signingPublicKey,
    signing.signingPrivateKey,
    kem.publicKey,
    { rootContainerId: first.rootContainerId },
  );
  for (const request of [first, retry]) {
    const response = await register(request);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Key already exists, try logging in",
    });
  }
  expect(
    await db.select().from(users).where(eq(users.id, retry.userId)),
  ).toHaveLength(0);
  expect(
    await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, retry.organizationId)),
  ).toHaveLength(0);
  const [root] = await db
    .select()
    .from(containers)
    .where(eq(containers.id, first.rootContainerId));
  expect(root?.organizationId).toBe(first.organizationId);
});

test("another key cannot reuse a registered root or leave a partial organization", async () => {
  const signing = generateSigningSeedAndKeyPair();
  const kem = generateKemSeedAndKeyPair();
  const first = await createRegistrationRequestBody(
    signing.signingPublicKey,
    signing.signingPrivateKey,
    kem.publicKey,
  );
  expect((await register(first)).status).toBe(200);
  const otherSigning = generateSigningSeedAndKeyPair();
  const otherKem = generateKemSeedAndKeyPair();
  const other = await createRegistrationRequestBody(
    otherSigning.signingPublicKey,
    otherSigning.signingPrivateKey,
    otherKem.publicKey,
    { rootContainerId: first.rootContainerId },
  );
  const response = await register(other);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Root container ID is unavailable",
  });
  expect(
    await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, other.organizationId)),
  ).toHaveLength(0);
  expect(
    await db.select().from(users).where(eq(users.id, other.userId)),
  ).toHaveLength(0);
  const [root] = await db
    .select()
    .from(containers)
    .where(eq(containers.id, first.rootContainerId));
  expect(root?.organizationId).toBe(first.organizationId);
});
