import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizations,
  users,
} from "@tearleads/api-shared/schema";
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

for (const binding of ["user", "hash", "signer"] as const) {
  test(`terminal replay requires the current ${binding} binding even without retained bootstrap`, async () => {
    const user = await actor();
    const body = await createOrganizationRequestBody(user);
    expect((await submitCreateOrganization(user, body)).status).toBe(200);
    const [receipt] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, body.organizationId));
    if (!receipt) throw new Error("expected committed receipt");
    await db
      .update(organizationBilling)
      .set({ status: "purged" })
      .where(eq(organizationBilling.organizationId, body.organizationId));
    await db
      .update(organizations)
      .set({ provisioningResponse: null })
      .where(eq(organizations.id, body.organizationId));
    if (binding === "signer") {
      await db
        .update(users)
        .set({
          signingPublicKey: bytesToBase64(
            generateSigningSeedAndKeyPair().signingPublicKey,
          ),
        })
        .where(eq(users.id, user.userId));
    } else {
      await db
        .update(organizations)
        .set(
          binding === "user"
            ? { provisioningUserId: crypto.randomUUID() }
            : { provisioningRequestSha256: "0".repeat(64) },
        )
        .where(eq(organizations.id, body.organizationId));
    }
    const refused = await submitCreateOrganization(user, body);
    expect(refused.status).toBe(binding === "signer" ? 400 : 409);
    expect(await refused.json()).not.toHaveProperty("code");
    await db
      .update(users)
      .set({ signingPublicKey: bytesToBase64(user.signing.signingPublicKey) })
      .where(eq(users.id, user.userId));
    await db
      .update(organizations)
      .set({
        provisioningUserId: receipt.provisioningUserId,
        provisioningRequestSha256: receipt.provisioningRequestSha256,
      })
      .where(eq(organizations.id, body.organizationId));
    const terminal = await submitCreateOrganization(user, body);
    expect(terminal.status).toBe(410);
    expect(await terminal.json()).toEqual({
      code: "organization_creation_purged",
      error:
        "Organization creation was committed but the organization was purged",
    });
  });
}

test("terminal replay is unavailable to another authenticated user or a different signed request", async () => {
  const user = await actor();
  const other = await actor();
  const body = await createOrganizationRequestBody(user);
  expect((await submitCreateOrganization(user, body)).status).toBe(200);
  await db
    .update(organizationBilling)
    .set({ status: "purged" })
    .where(eq(organizationBilling.organizationId, body.organizationId));
  expect((await submitCreateOrganization(other, body)).status).toBe(403);
  for (const signer of [user, other]) {
    const changed = await createOrganizationRequestBody(signer, {
      organizationId: body.organizationId,
      rootContainerId: body.rootContainerId,
    });
    const response = await submitCreateOrganization(signer, changed);
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("code");
  }
});
