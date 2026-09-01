import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  containerMetadataDocuments,
  organizationBilling,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import {
  type DocumentCreateRequest,
  type DocumentSyncRequest,
  isProvisionedDocumentRequest,
  isProvisionedSystemContainerRequest,
} from "@tearleads/validators/request";
import {
  isCreateOrganizationResponse,
  isDocumentSyncResponse,
} from "@tearleads/validators/response";
import { eq, inArray } from "drizzle-orm";
import invariant from "invariant";
import {
  createOrganizationRequestBody,
  submitCreateOrganization,
} from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

function documentCreateRequestId(request: DocumentCreateRequest): string {
  const documentId = Reflect.get(request.event, "objectId");
  invariant(typeof documentId === "string", "expected document id");
  return documentId;
}

async function expectProvisionedDocumentReadable(input: {
  documentId: string;
  initialSync: DocumentSyncRequest;
  user: TestUser;
}) {
  const initialUpdate = input.initialSync.outgoingUpdates[0];
  invariant(initialUpdate, "expected initial document update");
  const readRequest = {
    contentKeyEpoch: input.initialSync.contentKeyEpoch,
    expectedLinkSetManifestHash: input.initialSync.expectedLinkSetManifestHash,
    expectedTargetHash: input.initialSync.expectedTargetHash,
    localVersionVector: null,
    outgoingUpdates: [],
    supportsPullPagination: true,
  } satisfies DocumentSyncRequest;
  const request = (localVersionVector: string | null) =>
    routeApp.request(`/documents/${input.documentId}/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.user.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...readRequest, localVersionVector }),
    });

  const response = await request(null);
  expect(response.status).toBe(200);
  const sync = await response.json();
  invariant(isDocumentSyncResponse(sync), "expected document sync response");
  expect(sync.updates.map((update) => update.id)).toContain(initialUpdate.id);

  const caughtUpResponse = await request(input.initialSync.localVersionVector);
  expect(caughtUpResponse.status).toBe(200);
  const caughtUp = await caughtUpResponse.json();
  invariant(
    isDocumentSyncResponse(caughtUp),
    "expected caught-up sync response",
  );
  expect(caughtUp.updates).toEqual([]);
}

test("POST /organizations atomically stores core metadata bodies readable on local billing", async () => {
  const user = createTestUser();
  await registerUser(user);
  await authenticate(user);
  const body = await createOrganizationRequestBody(user, {
    includeOrganizationProfileDocument: true,
    includeRosterProfileDocument: true,
  });
  const rootMetadata = body.initialRootMetadataDocument;
  const rosterContainer = body.initialRosterProfileContainer;
  const organizationContainer = body.initialOrganizationMetadataContainer;
  invariant(
    isProvisionedDocumentRequest(rootMetadata),
    "expected provisioned root metadata",
  );
  invariant(
    isProvisionedSystemContainerRequest(rosterContainer),
    "expected provisioned roster profile container",
  );
  invariant(
    isProvisionedSystemContainerRequest(organizationContainer),
    "expected provisioned organization metadata container",
  );
  const committedUpdateIds = [
    rootMetadata.initialSync.outgoingUpdates[0]?.id,
    rosterContainer.initialMetadataSync.outgoingUpdates[0]?.id,
    organizationContainer.initialMetadataSync.outgoingUpdates[0]?.id,
  ];
  invariant(
    committedUpdateIds.every((updateId) => typeof updateId === "string"),
    "expected core metadata update ids",
  );

  const createResponse = await submitCreateOrganization(user, body);
  expect(createResponse.status).toBe(200);
  const createResponseBody = await createResponse.json();
  invariant(
    isCreateOrganizationResponse(createResponseBody),
    "expected provisioning body",
  );
  expect(createResponseBody.committedCoreMetadataUpdateIds).toEqual(
    committedUpdateIds,
  );
  const [billing] = await db
    .select({ status: organizationBilling.status })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, body.organizationId));
  expect(billing?.status).toBe("local");
  const coreMetadataDocumentIds = [
    documentCreateRequestId(rootMetadata),
    documentCreateRequestId(rosterContainer.metadataDocument),
    documentCreateRequestId(organizationContainer.metadataDocument),
  ];
  const metadataBindings = await db
    .select({ documentId: containerMetadataDocuments.documentId })
    .from(containerMetadataDocuments)
    .where(
      inArray(containerMetadataDocuments.documentId, coreMetadataDocumentIds),
    );
  expect(metadataBindings.map(({ documentId }) => documentId).sort()).toEqual(
    [...coreMetadataDocumentIds].sort(),
  );

  await expectProvisionedDocumentReadable({
    documentId: documentCreateRequestId(rootMetadata),
    initialSync: rootMetadata.initialSync,
    user,
  });
  await expectProvisionedDocumentReadable({
    documentId: documentCreateRequestId(rosterContainer.metadataDocument),
    initialSync: rosterContainer.initialMetadataSync,
    user,
  });
  await expectProvisionedDocumentReadable({
    documentId: documentCreateRequestId(organizationContainer.metadataDocument),
    initialSync: organizationContainer.initialMetadataSync,
    user,
  });
});
