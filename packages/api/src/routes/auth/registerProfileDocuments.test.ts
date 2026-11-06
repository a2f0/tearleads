import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  containerMetadataDocuments,
  documentContentKeyEpochs,
  organizationRosterEntries,
  organizations,
} from "@tearleads/api-shared/schema";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import {
  createRegistrationRequestBody,
  submitRegistration,
} from "../../../test/helpers/api";
import { routeApp } from "../../routeApp";

test("POST /auth/register provisions root metadata", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();

  const response = await submitRegistration(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const body = await response.json();
  expect(body.rootMetadataDocument.id).toBe(body.rootMetadataDocumentId);
  expect(body.rootMetadataDocument.contentKeyEpoch).toBe(1);

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

test("POST /auth/register binds an optional roster profile document", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  const body = await createRegistrationRequestBody(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
    {
      includeOrganizationProfileDocument: true,
      includeRosterProfileDocument: true,
    },
  );
  const rosterProfileDocumentId = body.initialRosterProfileDocument
    ? Reflect.get(body.initialRosterProfileDocument.event, "objectId")
    : undefined;
  const organizationProfileDocumentId = body.initialOrganizationProfileDocument
    ? Reflect.get(body.initialOrganizationProfileDocument.event, "objectId")
    : undefined;
  const rosterProfileContainer = body.initialRosterProfileContainer;
  const rosterProfileContainerId = rosterProfileContainer
    ? Reflect.get(rosterProfileContainer.container.event, "objectId")
    : undefined;
  const organizationMetadataContainer =
    body.initialOrganizationMetadataContainer;
  const organizationMetadataContainerId = organizationMetadataContainer
    ? Reflect.get(organizationMetadataContainer.container.event, "objectId")
    : undefined;
  invariant(
    typeof rosterProfileDocumentId === "string",
    "expected roster profile document id",
  );
  invariant(
    typeof rosterProfileContainerId === "string",
    "expected roster profile container id",
  );
  invariant(
    typeof organizationProfileDocumentId === "string",
    "expected organization profile document id",
  );
  invariant(
    typeof organizationMetadataContainerId === "string",
    "expected organization metadata container id",
  );
  invariant(
    rosterProfileContainer,
    "expected roster profile container request",
  );
  invariant(
    organizationMetadataContainer,
    "expected organization metadata container request",
  );

  const response = await routeApp.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const responseBody = await response.json();
  expect(responseBody.rosterProfileContainerId).toBe(rosterProfileContainerId);
  expect(responseBody.rosterProfileContainer.container.containerId).toBe(
    rosterProfileContainerId,
  );
  expect(responseBody.rosterProfileContainer.container.systemSlot).toBe(
    rosterProfileContainer.systemSlot,
  );
  expect(responseBody.rosterProfileContainer.metadataDocument.id).toBe(
    rosterProfileContainerId,
  );
  expect(responseBody.rosterProfileDocumentId).toBe(rosterProfileDocumentId);
  expect(responseBody.rosterProfileDocument.id).toBe(rosterProfileDocumentId);
  expect(responseBody.organizationProfileDocumentId).toBe(
    organizationProfileDocumentId,
  );
  expect(responseBody.organizationProfileDocument.id).toBe(
    organizationProfileDocumentId,
  );
  // The org profile document lives in its own metadata container, distinct from
  // the Admins-scoped roster profile container that holds private roster PII.
  expect(responseBody.organizationMetadataContainerId).toBe(
    organizationMetadataContainerId,
  );
  expect(responseBody.organizationMetadataContainer.container.containerId).toBe(
    organizationMetadataContainerId,
  );
  expect(organizationMetadataContainerId).not.toBe(rosterProfileContainerId);
  // The metadata container is born with a read grant to the Members group so
  // every active roster member can decrypt the org name; the server accepted
  // and verified both grants on the independent metadata root.
  expect(
    Reflect.get(
      organizationMetadataContainer.container.body as Record<string, unknown>,
      "directGrants",
    ),
  ).toEqual(
    expect.arrayContaining([
      {
        accessLevel: "read",
        subjectId: body.initialMemberGroup.groupId,
        subjectType: "group",
      },
      {
        accessLevel: "admin",
        subjectId: body.initialAdminGroup.groupId,
        subjectType: "group",
      },
    ]),
  );
  expect(
    responseBody.organizationMetadataContainer.container.parentId,
  ).toBeNull();

  const [[rosterEntry], [organization]] = await Promise.all([
    db
      .select({
        profileDocumentId: organizationRosterEntries.profileDocumentId,
      })
      .from(organizationRosterEntries)
      .where(eq(organizationRosterEntries.userId, responseBody.userId))
      .limit(1),
    db
      .select({ profileDocumentId: organizations.profileDocumentId })
      .from(organizations)
      .where(eq(organizations.id, responseBody.organizationId))
      .limit(1),
  ]);

  expect(rosterEntry?.profileDocumentId).toBe(rosterProfileDocumentId);
  expect(organization?.profileDocumentId).toBe(organizationProfileDocumentId);
});

test("POST /auth/register rejects an initial roster profile document without its container", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  const body = await createRegistrationRequestBody(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
    { includeRosterProfileDocument: true },
  );
  const requestBody = { ...body };
  delete requestBody.initialRosterProfileContainer;

  const response = await routeApp.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Initial roster profile document requires a profile container",
  });
});

test("POST /auth/register rejects an initial organization profile document without its container", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  const body = await createRegistrationRequestBody(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
    { includeOrganizationProfileDocument: true },
  );
  const requestBody = { ...body };
  Reflect.deleteProperty(requestBody, "initialOrganizationMetadataContainer");

  const response = await routeApp.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Invalid request",
  });
});
