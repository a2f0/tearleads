import { afterAll, expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containerBuiltinGrants } from "@tearleads/api-shared/schema";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { createRegistrationRequestBody } from "../../../test/helpers/api";
import { del } from "../../adapters/redis";
import { routeApp } from "../../routeApp";

let fingerprint: string;
afterAll(async () => {
  await del(fingerprint);
});

test("POST /auth/register marks the organization-metadata Members grant as built-in", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  fingerprint = await toFingerprint(signingPublicKey);

  // The metadata container (and its born-with read grant to the Members group)
  // is only provisioned when an organization profile document is included.
  const requestBody = await createRegistrationRequestBody(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
    { includeOrganizationProfileDocument: true },
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
});
