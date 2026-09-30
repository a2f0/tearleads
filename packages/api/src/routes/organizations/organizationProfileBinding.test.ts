import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  containerMetadataDocuments,
  containers,
  documentContainerLinks,
  organizations,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { isOrganizationReadModelResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
import { buildDocumentLinkRequest } from "../../../test/helpers/documentLinkMutation";
import { postDocumentPurge } from "../../../test/helpers/documentPurge";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { loadOrganizationMetadataContainerId } from "../../../test/helpers/organizationMetadataContainer";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

interface RegisteredAdmin {
  readonly actor: TestUser;
  readonly metadataContainerId: string;
  readonly organizationId: string;
}

async function registerAdmin(): Promise<RegisteredAdmin> {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, actor.userId));
  invariant(row, "expected registered user row");
  return {
    actor,
    metadataContainerId: await loadOrganizationMetadataContainerId(
      row.organizationId,
    ),
    organizationId: row.organizationId,
  };
}

async function createOrganizationDocument(
  admin: RegisteredAdmin,
  containerIds: readonly string[],
): Promise<string> {
  const document = await createCurrentDocumentProjection({
    containerIds,
    createdByFingerprint: admin.actor.fingerprint,
    organizationId: admin.organizationId,
  });
  return document.id;
}

async function loadProfilePointer(
  organizationId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ profileDocumentId: organizations.profileDocumentId })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  invariant(row, "expected organization row");
  return row.profileDocumentId;
}

async function putProfilePointer(
  admin: RegisteredAdmin,
  profileDocumentId: string,
): Promise<Response> {
  return await routeApp.request(
    `/organizations/${admin.organizationId}/profile`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${admin.actor.token}`,
      },
      body: JSON.stringify({ profileDocumentId }),
    },
  );
}

async function expectPointerRefused(
  admin: RegisteredAdmin,
  profileDocumentId: string,
): Promise<void> {
  const before = await loadProfilePointer(admin.organizationId);
  const response = await putProfilePointer(admin, profileDocumentId);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Profile document is not in this organization",
  });
  expect(await loadProfilePointer(admin.organizationId)).toBe(before);
}

test("admins may point the profile at a metadata-container document", async () => {
  const admin = await registerAdmin();
  const profileDocumentId = await createOrganizationDocument(admin, [
    admin.metadataContainerId,
  ]);

  const response = await putProfilePointer(admin, profileDocumentId);

  expect(response.status).toBe(200);
  expect(await loadProfilePointer(admin.organizationId)).toBe(
    profileDocumentId,
  );
});

test("the profile pointer refuses a document outside the metadata container", async () => {
  const admin = await registerAdmin();
  const documentId = await createOrganizationDocument(admin, [
    admin.actor.rootContainerId,
  ]);

  await expectPointerRefused(admin, documentId);
});

test("the profile pointer refuses a document also linked elsewhere", async () => {
  const admin = await registerAdmin();
  const documentId = await createOrganizationDocument(admin, [
    admin.metadataContainerId,
    admin.actor.rootContainerId,
  ]);

  await expectPointerRefused(admin, documentId);
});

test("the profile pointer refuses the metadata container's own document", async () => {
  const admin = await registerAdmin();
  const [metadataDocument] = await db
    .select({ documentId: containerMetadataDocuments.documentId })
    .from(containerMetadataDocuments)
    .where(
      eq(containerMetadataDocuments.containerId, admin.metadataContainerId),
    );
  invariant(metadataDocument, "expected the container metadata document");

  await expectPointerRefused(admin, metadataDocument.documentId);
});

async function readDirectoryProfilePointer(
  admin: RegisteredAdmin,
): Promise<string | null> {
  const response = await routeApp.request(
    `/organizations/${admin.organizationId}/read-model`,
    { headers: { Authorization: `Bearer ${admin.actor.token}` } },
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  invariant(
    isOrganizationReadModelResponse(body) && body.mode === "snapshot",
    "expected organization read-model snapshot",
  );
  return body.lanes.directory.profileDocumentId;
}

test("the directory withholds a stored pointer that does not validate", async () => {
  const admin = await registerAdmin();
  const profileDocumentId = await createOrganizationDocument(admin, [
    admin.metadataContainerId,
  ]);
  expect((await putProfilePointer(admin, profileDocumentId)).status).toBe(200);
  expect(await readDirectoryProfilePointer(admin)).toBe(profileDocumentId);

  // The link and purge guards keep a bound document in place, so only a
  // direct write can store this; the read check is defence in depth.
  const multiplyLinkedDocumentId = await createOrganizationDocument(admin, [
    admin.metadataContainerId,
    admin.actor.rootContainerId,
  ]);
  await db
    .update(organizations)
    .set({ profileDocumentId: multiplyLinkedDocumentId })
    .where(eq(organizations.id, admin.organizationId));

  expect(await readDirectoryProfilePointer(admin)).toBeNull();
});

/**
 * Relabels the admin's signed root as the metadata container, so a document
 * created through the routes can be bound and then relinked or purged.
 */
async function bindSignedProfileDocument(admin: RegisteredAdmin) {
  const root = await bootstrapRoot(admin.actor);
  await db
    .update(containers)
    .set({ systemSlot: "retired-metadata-slot" })
    .where(eq(containers.id, admin.metadataContainerId));
  await db
    .update(containers)
    .set({
      systemSlot: await deriveOrganizationMetadataContainerSystemSlot({
        organizationId: admin.organizationId,
      }),
    })
    .where(eq(containers.id, root.kekState.containerId));
  const profile = await createDocument({ owner: admin.actor, root });
  expect((await putProfilePointer(admin, profile.id)).status).toBe(200);
  return { profile, root };
}

test("a bound organization profile cannot gain another container link", async () => {
  const admin = await registerAdmin();
  const { profile, root } = await bindSignedProfileDocument(admin);
  const secondContainer = await createChildContainer({
    parent: root,
    signer: admin.actor,
  });
  const linkRequest = await buildDocumentLinkRequest({
    child: secondContainer,
    createdDocument: profile,
    owner: admin.actor,
    root,
  });

  const response = await routeApp.request(`/documents/${profile.id}/link`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${admin.actor.token}`,
    },
    body: JSON.stringify(linkRequest),
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error:
      "Bound organization profile documents must remain exclusively in the organization metadata container",
  });
  const links = await db
    .select({ containerId: documentContainerLinks.containerId })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, profile.id));
  expect(links.map((link) => link.containerId)).toEqual([
    root.kekState.containerId,
  ]);
  expect(await readDirectoryProfilePointer(admin)).toBe(profile.id);
});

test("a bound organization profile document cannot be purged", async () => {
  const admin = await registerAdmin();
  const { profile, root } = await bindSignedProfileDocument(admin);

  const response = await postDocumentPurge({
    documentId: profile.id,
    documentManifestHash: profile.accessManifest.manifestHash,
    owner: admin.actor,
    root,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Bound organization profile documents cannot be purged",
  });
  expect(await loadProfilePointer(admin.organizationId)).toBe(profile.id);
});
