import { afterAll, expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  containerBuiltinGrants,
  containers,
  organizations,
  users,
} from "@tearleads/api-shared/schema";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { createRegistrationRequestBody } from "../../../test/helpers/api";
import { del } from "../../adapters/redis";
import { routeApp } from "../../routeApp";

const fingerprints: string[] = [];
afterAll(async () => {
  await Promise.all(fingerprints.map((fingerprint) => del(fingerprint)));
});

test.each([false, true])(
  "POST /auth/register always provisions metadata with reserved grants (profile=%s)",
  async (includeOrganizationProfileDocument) => {
    const { signingPrivateKey, signingPublicKey } =
      generateSigningSeedAndKeyPair();
    const { publicKey } = generateKemSeedAndKeyPair();
    fingerprints.push(await toFingerprint(signingPublicKey));

    // Group-name keying requires this root even without an organization profile.
    const requestBody = await createRegistrationRequestBody(
      signingPublicKey,
      signingPrivateKey,
      publicKey,
      { includeOrganizationProfileDocument },
    );

    const response = await routeApp.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json();
    invariant(
      typeof body.organizationMetadataContainerId === "string",
      "expected organization metadata container id",
    );
    expect(body.organizationMetadataContainer.container.containerId).toBe(
      body.organizationMetadataContainerId,
    );
    expect(body.organizationMetadataContainer.container.parentId).toBeNull();
    const [metadata] = await db
      .select()
      .from(containers)
      .where(eq(containers.id, body.organizationMetadataContainerId));
    expect(metadata).toMatchObject({
      organizationId: body.organizationId,
      parentId: null,
      depth: 0,
    });
    const [organization] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, body.organizationId));
    expect(organization?.profileDocumentId).toBe(
      includeOrganizationProfileDocument
        ? body.organizationProfileDocumentId
        : null,
    );
    if (!includeOrganizationProfileDocument) {
      expect(requestBody.initialOrganizationProfileDocument).toBeUndefined();
      expect(body.organizationProfileDocument).toBeUndefined();
      expect(body.organizationProfileDocumentId).toBeUndefined();
    }

    const builtinGrants = await db
      .select({
        accessLevel: containerBuiltinGrants.accessLevel,
        containerId: containerBuiltinGrants.containerId,
        organizationId: containerBuiltinGrants.organizationId,
        subjectId: containerBuiltinGrants.subjectId,
        subjectType: containerBuiltinGrants.subjectType,
      })
      .from(containerBuiltinGrants)
      .where(eq(containerBuiltinGrants.organizationId, body.organizationId));

    // The personal root and independent metadata root retain reserved grants.
    expect(builtinGrants).toContainEqual({
      accessLevel: "admin",
      containerId: body.rootContainerId,
      organizationId: body.organizationId,
      subjectId: requestBody.initialAdminGroup.groupId,
      subjectType: "group",
    });
    expect(builtinGrants).toContainEqual({
      accessLevel: "read",
      containerId: body.organizationMetadataContainerId,
      organizationId: body.organizationId,
      subjectId: requestBody.initialMemberGroup.groupId,
      subjectType: "group",
    });
    expect(builtinGrants).toContainEqual({
      accessLevel: "admin",
      containerId: body.organizationMetadataContainerId,
      organizationId: body.organizationId,
      subjectId: requestBody.initialAdminGroup.groupId,
      subjectType: "group",
    });
    expect(builtinGrants).toHaveLength(3);
  },
);

test("POST /auth/register rejects a profile-less request that omits the metadata root", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  const fingerprint = await toFingerprint(signingPublicKey);
  fingerprints.push(fingerprint);
  const requestBody = await createRegistrationRequestBody(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );
  Reflect.deleteProperty(requestBody, "initialOrganizationMetadataContainer");
  const response = await routeApp.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid request" });
  expect(
    await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.fingerprint, fingerprint)),
  ).toEqual([]);
});

test("POST /auth/register binds the required metadata root to the organization's reserved slot", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  fingerprints.push(await toFingerprint(signingPublicKey));
  const requestBody = await createRegistrationRequestBody(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );
  requestBody.initialOrganizationMetadataContainer.systemSlot =
    await deriveOrganizationMetadataContainerSystemSlot({
      organizationId: crypto.randomUUID(),
    });
  const response = await routeApp.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Initial organization metadata container has the wrong system slot",
  });
});
