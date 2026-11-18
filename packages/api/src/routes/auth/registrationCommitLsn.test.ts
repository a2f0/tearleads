import { expect, test } from "bun:test";
import { toFingerprint } from "@tearleads/crypto";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import {
  type DocumentCreateSeedRequest,
  type DocumentSyncRequest,
  documentCreateSeedSyncRequest,
  type RegistrationRequest,
} from "@tearleads/validators/request";
import {
  isDocumentSyncResponse,
  isRegistrationResponse,
} from "@tearleads/validators/response";
import invariant from "invariant";
import { createRegistrationRequestBody } from "../../../test/helpers/api/submitRegistration";
import { authenticate } from "../../../test/helpers/authenticate";
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

/** Every document registration seeds, with the sync that seeded it. */
function seededDocuments(body: RegistrationRequest): SeededDocument[] {
  const seeded = (
    create: Parameters<typeof documentCreateSeedSyncRequest>[0] | undefined,
    seed: DocumentCreateSeedRequest | undefined,
  ) =>
    create && seed
      ? [seededDocument(documentCreateSeedSyncRequest(create, seed))]
      : [];
  return [
    ...seeded(
      body.initialRootMetadataDocument,
      body.initialRootMetadataDocument.initialSync,
    ),
    ...seeded(
      body.initialRosterProfileContainer?.metadataDocument,
      body.initialRosterProfileContainer?.initialMetadataSync,
    ),
    ...seeded(
      body.initialRosterProfileDocument,
      body.initialRosterProfileDocument?.initialSync,
    ),
    ...seeded(
      body.initialOrganizationMetadataContainer.metadataDocument,
      body.initialOrganizationMetadataContainer.initialMetadataSync,
    ),
    ...seeded(
      body.initialOrganizationProfileDocument,
      body.initialOrganizationProfileDocument?.initialSync,
    ),
    ...(body.initialSystemContainers ?? []).flatMap((container) =>
      seeded(container.metadataDocument, container.initialMetadataSync),
    ),
  ];
}

/** A first read from nothing, bounded below by the registration position. */
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

test("the registration response's commit position covers every seeded document", async () => {
  const user = createTestUser();
  user.fingerprint = await toFingerprint(user.signing.signingPublicKey);
  const body = await createRegistrationRequestBody(
    user.signing.signingPublicKey,
    user.signing.signingPrivateKey,
    user.kem.publicKey,
    {
      includeOrganizationProfileDocument: true,
      includeRosterProfileDocument: true,
      includeTrashSystemContainer: true,
    },
  );
  const response = await routeApp.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  const registered = await response.json();
  invariant(isRegistrationResponse(registered), "expected registration");
  user.userId = registered.userId;
  user.rootContainerId = registered.rootContainerId;
  await authenticate(user);
  expect(registered.commitLsnMode).toBe("tracked");
  const minLsn = registered.commitLsn;
  invariant(minLsn !== null, "expected a tracked commit position");

  const documents = seededDocuments(body);
  // Root, both profile containers and documents, and the Trash container.
  expect(documents).toHaveLength(6);
  for (const document of documents) {
    // Read-your-writes holds at the reported position: a read from nothing
    // returns exactly the update registration seeded.
    const read = await firstRead({ document, minLsn, user });
    expect(read.status).toBe(200);
    const sync = await read.json();
    invariant(isDocumentSyncResponse(sync), "expected a document sync");
    expect(sync.updates.map((update) => update.id)).toEqual(
      document.initialSync.outgoingUpdates.map((update) => update.id),
    );
  }
});
