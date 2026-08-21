import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { documents, organizations } from "@symcrypt/api-shared/schema";
import { createTestUser, type TestUser } from "@symcrypt/bob-and-alice";
import {
  isProvisionedDocumentRequest,
  type ProvisionedDocumentRequest,
} from "@symcrypt/validators/request";
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
