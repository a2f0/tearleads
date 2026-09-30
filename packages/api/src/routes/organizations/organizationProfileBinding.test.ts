import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  containerMetadataDocuments,
  organizations,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { isOrganizationReadModelResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
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

test("the directory withholds a stored pointer that no longer validates", async () => {
  const admin = await registerAdmin();
  const profileDocumentId = await createOrganizationDocument(admin, [
    admin.metadataContainerId,
  ]);
  expect((await putProfilePointer(admin, profileDocumentId)).status).toBe(200);
  expect(await readDirectoryProfilePointer(admin)).toBe(profileDocumentId);

  // An admin later links the profile document into a container others write.
  const relinkedDocumentId = await createOrganizationDocument(admin, [
    admin.metadataContainerId,
    admin.actor.rootContainerId,
  ]);
  await db
    .update(organizations)
    .set({ profileDocumentId: relinkedDocumentId })
    .where(eq(organizations.id, admin.organizationId));

  expect(await readDirectoryProfilePointer(admin)).toBeNull();
});
