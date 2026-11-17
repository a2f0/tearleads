import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import type {
  DocumentSyncRequest,
  ProvisionedDocumentRequest,
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

/** A caught-up read of a seeded document, asserting the provisioning commit. */
async function caughtUpRead(input: {
  readonly documentRequest: ProvisionedDocumentRequest;
  readonly minLsn: string;
  readonly user: TestUser;
}) {
  const initialSync = input.documentRequest.initialSync;
  const documentId = Reflect.get(input.documentRequest.event, "objectId");
  invariant(typeof documentId === "string", "expected document id");
  const request = {
    contentKeyEpoch: initialSync.contentKeyEpoch,
    expectedLinkSetManifestHash: initialSync.expectedLinkSetManifestHash,
    expectedTargetHash: initialSync.expectedTargetHash,
    localVersionVector: initialSync.localVersionVector,
    minLsn: input.minLsn,
    outgoingUpdates: [],
    supportsPullPagination: true,
  } satisfies DocumentSyncRequest;
  return routeApp.request(`/documents/${documentId}/sync`, {
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
  });
  const response = await submitCreateOrganization(user, body);
  expect(response.status).toBe(200);
  const created = await response.json();
  invariant(isCreateOrganizationResponse(created), "expected provisioning");
  expect(created.commitLsnMode).toBe("tracked");
  const minLsn = created.commitLsn;
  invariant(minLsn !== null, "expected a tracked commit position");

  for (const documentRequest of [
    body.initialOrganizationProfileDocument,
    body.initialRosterProfileDocument,
  ]) {
    invariant(documentRequest, "expected a seeded profile document");
    // Read-your-writes holds at the reported position, and a client holding
    // the seeded state has nothing to pull.
    const read = await caughtUpRead({ documentRequest, minLsn, user });
    expect(read.status).toBe(200);
    const sync = await read.json();
    invariant(isDocumentSyncResponse(sync), "expected a document sync");
    expect(sync.updates).toEqual([]);
  }
});
