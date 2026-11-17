import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import type {
  CreateOrganizationRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import {
  isCreateOrganizationResponse,
  isDocumentSyncResponse,
} from "@tearleads/validators/response";
import invariant from "invariant";
import {
  createOrganizationRequestBody,
  submitCreateOrganization,
} from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

interface SeededDocument {
  readonly documentId: string;
  readonly initialSync: DocumentSyncRequest;
}

function seededDocument(initialSync: DocumentSyncRequest): SeededDocument {
  const documentId = Reflect.get(
    initialSync.outgoingUpdates[0]?.writeHeader ?? {},
    "objectId",
  );
  invariant(typeof documentId === "string", "expected a seeded document id");
  return { documentId, initialSync };
}

/** Every document provisioning seeds, with the sync that seeded it. */
function seededDocuments(body: CreateOrganizationRequest): SeededDocument[] {
  return [
    body.initialRootMetadataDocument.initialSync,
    body.initialRosterProfileContainer?.initialMetadataSync,
    body.initialRosterProfileDocument?.initialSync,
    body.initialOrganizationMetadataContainer.initialMetadataSync,
    body.initialOrganizationProfileDocument?.initialSync,
    ...(body.initialSystemContainers ?? []).map(
      (container) => container.initialMetadataSync,
    ),
  ].flatMap((initialSync) =>
    initialSync ? [seededDocument(initialSync)] : [],
  );
}

/** A first read from nothing, bounded below by the provisioning position. */
async function firstRead(input: {
  readonly document: SeededDocument;
  readonly minLsn: string;
  readonly user: TestUser;
}) {
  const { initialSync } = input.document;
  const request = {
    contentKeyEpoch: initialSync.contentKeyEpoch,
    expectedLinkSetManifestHash: initialSync.expectedLinkSetManifestHash,
    expectedTargetHash: initialSync.expectedTargetHash,
    localVersionVector: null,
    minLsn: input.minLsn,
    outgoingUpdates: [],
    supportsPullPagination: true,
  } satisfies DocumentSyncRequest;
  return routeApp.request(`/documents/${input.document.documentId}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.user.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

test("the provisioning response's commit position covers every seeded document", async () => {
  const user = createTestUser();
  await registerUser(user);
  await authenticate(user);
  const body = await createOrganizationRequestBody(user, {
    includeOrganizationProfileDocument: true,
    includeRosterProfileDocument: true,
    includeTrashSystemContainer: true,
  });
  const response = await submitCreateOrganization(user, body);
  expect(response.status).toBe(200);
  const created = await response.json();
  invariant(isCreateOrganizationResponse(created), "expected provisioning");
  expect(created.commitLsnMode).toBe("tracked");
  const minLsn = created.commitLsn;
  invariant(minLsn !== null, "expected a tracked commit position");

  const documents = seededDocuments(body);
  // Root, both profile containers and documents, and the Trash container.
  expect(documents).toHaveLength(6);
  for (const document of documents) {
    // Read-your-writes holds at the reported position: a read from nothing
    // returns exactly the update provisioning seeded.
    const read = await firstRead({ document, minLsn, user });
    expect(read.status).toBe(200);
    const sync = await read.json();
    invariant(isDocumentSyncResponse(sync), "expected a document sync");
    expect(sync.updates.map((update) => update.id)).toEqual(
      document.initialSync.outgoingUpdates.map((update) => update.id),
    );
  }
});
