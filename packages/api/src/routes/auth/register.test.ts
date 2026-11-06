import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  containers,
  groups,
  organizations,
  users,
} from "@tearleads/api-shared/schema";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { submitRegistration } from "../../../test/helpers/api";
import { get } from "../../adapters/keyValueStore";
import { listOrganizationContainerGrantRows } from "../../workflows/organizations/containerGrants";

function decodeKey(value: string): number[] {
  return Array.from(base64ToBytes(value));
}

test("POST /auth/register keeps the signing key out of the key/value store", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  const fingerprint = await toFingerprint(signingPublicKey);

  const res = await submitRegistration(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(typeof body.userId).toBe("string");
  expect(body.userId.length).toBeGreaterThan(0);
  expect(typeof body.rootMetadataDocumentId).toBe("string");
  expect(body.rootMetadataAccessEpoch).toBe(1);
  expect(typeof body.rootMetadataAccessStateHash).toBe("string");
  expect(body.rootMetadataAccessStateHash.length).toBeGreaterThan(0);

  // Login reads the canonical database key; nothing caches it by fingerprint.
  expect(await get(fingerprint)).toBeNull();
});

test("POST /auth/register creates a user with the source IP", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  const fingerprint = await toFingerprint(signingPublicKey);

  const res = await submitRegistration(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );
  expect(res.status).toBe(200);
  const body = await res.json();

  const [user] = await db.select().from(users).where(eq(users.id, body.userId));

  invariant(user, "expected user to exist in postgres");
  expect(user.fingerprint).toBe(fingerprint);
  expect(decodeKey(user.signingPublicKey)).toEqual([...signingPublicKey]);
  expect(user.encapsulationKeyFingerprint).toBe(await toFingerprint(publicKey));
  expect(user.registrationSourceIpAddress).toBe("198.51.100.10");
});

test("POST /auth/register creates reserved admin and member groups in postgres", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();

  const res = await submitRegistration(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );
  expect(res.status).toBe(200);
  const body = await res.json();

  const [organization] = await db
    .select({
      adminGroupId: organizations.adminGroupId,
      memberGroupId: organizations.memberGroupId,
    })
    .from(organizations)
    .where(eq(organizations.id, body.organizationId));

  invariant(organization?.adminGroupId, "expected organization admin group id");
  invariant(
    organization.memberGroupId,
    "expected organization member group id",
  );

  const reservedGroups = await db
    .select({
      groupId: groups.id,
      organizationId: groups.organizationId,
    })
    .from(groups)
    .where(eq(groups.organizationId, body.organizationId));

  expect(reservedGroups).toEqual(
    expect.arrayContaining([
      {
        groupId: organization.adminGroupId,
        organizationId: body.organizationId,
      },
      {
        groupId: organization.memberGroupId,
        organizationId: body.organizationId,
      },
    ]),
  );
});

test("POST /auth/register marks the bootstrap admin grant as built-in", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();

  const res = await submitRegistration(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );
  expect(res.status).toBe(200);
  const body = await res.json();

  const [organization] = await db
    .select({
      adminGroupId: organizations.adminGroupId,
      rootContainerId: organizations.rootContainerId,
    })
    .from(organizations)
    .where(eq(organizations.id, body.organizationId));
  invariant(organization, "expected organization row");
  expect(organization.rootContainerId).toBe(body.rootContainerId);

  // The root's built-in Admins grant is derived from the organization row.
  const rootBuiltinGrants = (
    await listOrganizationContainerGrantRows({
      executor: db,
      organizationId: body.organizationId,
    })
  )
    .filter((row) => row.isBuiltin && row.containerId === body.rootContainerId)
    .map((row) => ({
      accessLevel: row.accessLevel,
      subjectId: row.subjectId,
      subjectType: row.subjectType,
    }));
  expect(rootBuiltinGrants).toEqual([
    {
      accessLevel: "admin",
      subjectId: organization.adminGroupId,
      subjectType: "group",
    },
  ]);
});

test("POST /auth/register returns 409 when key already exists", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();

  const first = await submitRegistration(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );
  expect(first.status).toBe(200);

  const second = await submitRegistration(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );
  expect(second.status).toBe(409);
  expect(await second.json()).toEqual({
    error: "Key already exists, try logging in",
  });
});

test("POST /auth/register rolls back organization and container rows on duplicate fingerprint", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();

  const countOrganizations = async () =>
    (await db.select().from(organizations)).length;
  const countContainers = async () =>
    (await db.select().from(containers)).length;

  const organizationsBefore = await countOrganizations();
  const containersBefore = await countContainers();

  const first = await submitRegistration(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );
  expect(first.status).toBe(200);

  const organizationsAfterFirst = await countOrganizations();
  const containersAfterFirst = await countContainers();
  expect(organizationsAfterFirst).toBe(organizationsBefore + 1);
  expect(containersAfterFirst).toBe(containersBefore + 2);

  const second = await submitRegistration(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );
  expect(second.status).toBe(409);

  expect(await countOrganizations()).toBe(organizationsAfterFirst);
  expect(await countContainers()).toBe(containersAfterFirst);
});
