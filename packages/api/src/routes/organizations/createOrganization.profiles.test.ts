import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documents, organizations } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import {
  type DocumentCreateRequest,
  isProvisionedDocumentRequest,
  type ProvisionedDocumentRequest,
} from "@tearleads/validators/request";
import { isCreateOrganizationResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import {
  createOrganizationRequestBody,
  submitCreateOrganization,
} from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { makeProvisionedDocumentSeedDependencyBearing } from "../../../test/helpers/provisionedSystemContainer";
import { registerUser } from "../../../test/helpers/registerUser";

async function registeredActor(): Promise<TestUser> {
  const user = createTestUser();
  await registerUser(user);
  await authenticate(user);
  return user;
}

function provisionedProfileDocumentId(
  request: ProvisionedDocumentRequest,
): string {
  const documentId = Reflect.get(request.event, "objectId");
  invariant(typeof documentId === "string", "expected profile document id");
  return documentId;
}

function toLegacyProfileDocumentRequest(
  request: ProvisionedDocumentRequest,
): DocumentCreateRequest {
  const { initialSync: _initialSync, ...legacyRequest } = request;
  return legacyRequest;
}

test("POST /organizations accepts legacy profile documents without claiming their bodies", async () => {
  const user = await registeredActor();
  const body = await createOrganizationRequestBody(user, {
    includeOrganizationProfileDocument: true,
    includeRosterProfileDocument: true,
  });
  const rosterProfile = body.initialRosterProfileDocument;
  const organizationProfile = body.initialOrganizationProfileDocument;
  invariant(
    isProvisionedDocumentRequest(rosterProfile),
    "expected initial roster profile",
  );
  invariant(
    isProvisionedDocumentRequest(organizationProfile),
    "expected initial organization profile",
  );
  body.initialRosterProfileDocument =
    toLegacyProfileDocumentRequest(rosterProfile);
  body.initialOrganizationProfileDocument =
    toLegacyProfileDocumentRequest(organizationProfile);

  const response = await submitCreateOrganization(user, body);
  expect(response.status).toBe(200);
  const responseBody = await response.json();
  invariant(
    isCreateOrganizationResponse(responseBody),
    "expected provisioning body",
  );
  expect(responseBody.committedProfileUpdateIds).toEqual([]);
  expect(responseBody.rosterProfileDocumentId).toBe(
    provisionedProfileDocumentId(rosterProfile),
  );
  expect(responseBody.organizationProfileDocumentId).toBe(
    provisionedProfileDocumentId(organizationProfile),
  );
});

test("POST /organizations rejects a signed dependency-bearing profile seed and rolls back", async () => {
  const user = await registeredActor();
  const body = await createOrganizationRequestBody(user, {
    includeOrganizationProfileDocument: true,
    includeRosterProfileDocument: true,
  });
  const profile = body.initialOrganizationProfileDocument;
  invariant(
    isProvisionedDocumentRequest(profile),
    "expected initial organization profile",
  );
  await makeProvisionedDocumentSeedDependencyBearing(
    profile,
    user.signing.signingPrivateKey,
  );

  const response = await submitCreateOrganization(user, body);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error:
      "Provisioned document initial update must start from an empty version vector",
  });

  const [organizationRows, documentRows] = await Promise.all([
    db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, body.organizationId)),
    db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, provisionedProfileDocumentId(profile))),
  ]);
  expect(organizationRows).toHaveLength(0);
  expect(documentRows).toHaveLength(0);
});
