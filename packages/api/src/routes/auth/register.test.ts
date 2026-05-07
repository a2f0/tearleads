import { afterAll, expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import {
  createRegistrationRequestBody,
  submitRegistration,
} from "../../../test/helpers/api";
import { db } from "../../adapters/postgres";
import { del, get } from "../../adapters/redis";
import { routeApp } from "../../routeApp";
import {
  containerMetadataDocuments,
  containers,
  documentContentKeyEpochs,
  organizations,
  users,
} from "../../schema";

let fingerprint: string;

function decodeKey(value: string): number[] {
  return Array.from(base64ToBytes(value));
}

afterAll(async () => {
  await del(fingerprint);
});

test("POST /auth/register stores the key in redis keyed by fingerprint", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  const keyArray = Array.from(signingPublicKey);
  fingerprint = await toFingerprint(signingPublicKey);

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

  const stored = await get(fingerprint);
  invariant(stored, "expected publicKey to be stored in redis by fingerprint");
  expect(decodeKey(stored)).toEqual(keyArray);
});

test("POST /auth/register creates a user in postgres", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  const keyArray = Array.from(signingPublicKey);
  const encapsulationFingerprint = await toFingerprint(publicKey);
  fingerprint = await toFingerprint(signingPublicKey);

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
  expect(decodeKey(user.signingPublicKey)).toEqual(keyArray);
  expect(user.encapsulationKeyFingerprint).toBe(encapsulationFingerprint);
});

test("POST /auth/register returns 409 when key already exists", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  fingerprint = await toFingerprint(signingPublicKey);

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
  expect(await second.json()).toEqual({ error: "Key already exists" });
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
  expect(containersAfterFirst).toBe(containersBefore + 1);

  const second = await submitRegistration(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );
  expect(second.status).toBe(409);

  expect(await countOrganizations()).toBe(organizationsAfterFirst);
  expect(await countContainers()).toBe(containersAfterFirst);
});

test("POST /auth/register rejects initial org policies that do not bootstrap the registering user as sole admin", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  fingerprint = await toFingerprint(signingPublicKey);
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
  fingerprint = await toFingerprint(signingPublicKey);
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

test("POST /auth/register provisions root metadata", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();

  const response = await submitRegistration(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.rootMetadataDocument.id).toBe(body.rootMetadataDocumentId);
  expect(body.rootMetadataDocument.contentKeyBundle.documentId).toBe(
    body.rootMetadataDocumentId,
  );

  const [metadataBinding] = await db
    .select({
      containerId: containerMetadataDocuments.containerId,
      documentId: containerMetadataDocuments.documentId,
    })
    .from(containerMetadataDocuments)
    .where(eq(containerMetadataDocuments.containerId, body.rootContainerId))
    .limit(1);

  expect(metadataBinding?.containerId).toBe(body.rootContainerId);
  expect(metadataBinding?.documentId).toBe(body.rootMetadataDocumentId);

  const [contentKeyEpoch] = await db
    .select({ contentKeyEpoch: documentContentKeyEpochs.contentKeyEpoch })
    .from(documentContentKeyEpochs)
    .where(eq(documentContentKeyEpochs.documentId, body.rootMetadataDocumentId))
    .limit(1);
  expect(contentKeyEpoch?.contentKeyEpoch).toBe(1);
});
