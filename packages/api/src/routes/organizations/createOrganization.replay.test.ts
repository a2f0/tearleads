import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizations, users } from "@tearleads/api-shared/schema";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import {
  createOrganizationRequestBody,
  submitCreateOrganization,
} from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";

async function actor() {
  const user = createTestUser();
  await registerUser(user);
  await authenticate(user);
  return user;
}

test("ordinary create replays concurrent and canonically reordered requests", async () => {
  const user = await actor();
  const body = await createOrganizationRequestBody(user);
  const responses = await Promise.all([
    submitCreateOrganization(user, body),
    submitCreateOrganization(user, body),
  ]);
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  const committed = await responses[0]?.json();
  expect(await responses[1]?.json()).toEqual(committed);
  const { userId, ...rest } = body;
  const replay = await submitCreateOrganization(user, { ...rest, userId });
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(committed);
  expect(
    await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, body.organizationId)),
  ).toHaveLength(1);
});

test("ordinary replay rejects another authenticated user and a different valid request", async () => {
  const user = await actor();
  const other = await actor();
  const body = await createOrganizationRequestBody(user);
  expect((await submitCreateOrganization(user, body)).status).toBe(200);
  expect((await submitCreateOrganization(other, body)).status).toBe(403);
  const changed = await createOrganizationRequestBody(user, {
    organizationId: body.organizationId,
    rootContainerId: body.rootContainerId,
  });
  expect((await submitCreateOrganization(user, changed)).status).toBe(409);
  const otherSigned = await createOrganizationRequestBody(other, {
    organizationId: body.organizationId,
    rootContainerId: body.rootContainerId,
  });
  expect((await submitCreateOrganization(other, otherSigned)).status).toBe(409);
});

test("ordinary replay validates the current signer before reading a stored success", async () => {
  const user = await actor();
  const body = await createOrganizationRequestBody(user);
  expect((await submitCreateOrganization(user, body)).status).toBe(200);
  await db
    .update(users)
    .set({
      signingPublicKey: bytesToBase64(
        generateSigningSeedAndKeyPair().signingPublicKey,
      ),
    })
    .where(eq(users.id, user.userId));
  try {
    expect((await submitCreateOrganization(user, body)).status).toBe(400);
  } finally {
    await db
      .update(users)
      .set({ signingPublicKey: bytesToBase64(user.signing.signingPublicKey) })
      .where(eq(users.id, user.userId));
  }
});

for (const binding of ["user", "hash"] as const) {
  test(`ordinary replay refuses an inconsistent stored ${binding} binding`, async () => {
    const user = await actor();
    const body = await createOrganizationRequestBody(user);
    expect((await submitCreateOrganization(user, body)).status).toBe(200);
    await db
      .update(organizations)
      .set(
        binding === "user"
          ? { provisioningUserId: crypto.randomUUID() }
          : { provisioningRequestSha256: "0".repeat(64) },
      )
      .where(eq(organizations.id, body.organizationId));
    expect((await submitCreateOrganization(user, body)).status).toBe(409);
  });
}
