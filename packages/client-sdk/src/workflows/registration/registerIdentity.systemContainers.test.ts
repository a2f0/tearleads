import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import {
  documentCreateSeedSyncRequest,
  isDocumentSyncRequest,
} from "@tearleads/validators/request";
import { type RegistrationApi, registerIdentity } from "./registerIdentity";

test("registration includes initial metadata in the personal-org transaction", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  type RegisterUserParameters = Parameters<RegistrationApi["registerUser"]>;
  let initialRootMetadataDocument: RegisterUserParameters[9] | undefined;
  let initialRosterProfileContainer: RegisterUserParameters[10];
  let initialOrganizationMetadataContainer:
    | RegisterUserParameters[12]
    | undefined;
  let initialSystemContainers: RegisterUserParameters[14];

  const response = await registerIdentity({
    identityTrustDomain: "https://api.example.test",
    apiClient: {
      registerUser: async (
        ...args: Parameters<RegistrationApi["registerUser"]>
      ) => {
        initialRootMetadataDocument = args[9];
        initialRosterProfileContainer = args[10];
        initialOrganizationMetadataContainer = args[12];
        initialSystemContainers = args[14];
        return null;
      },
    },
    containerId: crypto.randomUUID(),
    dbClient: {
      exec: async () => {
        throw new Error("Unexpected database access for a rejected request");
      },
    },
    encapsulationKeyPair,
    pinLocalUserIdentity: async () => undefined,
    provisionedSystemContainers: [
      {
        icon: "trash",
        name: "Trash",
        slotDefinition: {
          namespace: "tearleads.explorer",
          projectorId: "explorer",
          slotId: "trash",
          version: 1,
        },
      },
    ],
    signingKeyPair,
  });

  expect(response).toBeNull();
  if (
    !initialRootMetadataDocument ||
    !initialRosterProfileContainer ||
    !initialOrganizationMetadataContainer
  )
    throw new Error("Expected provisioned metadata documents");
  expect(initialSystemContainers).toHaveLength(1);
  const provisionedTrash = initialSystemContainers?.[0];
  if (!provisionedTrash) throw new Error("Expected provisioned Trash");
  expect(provisionedTrash.systemSlot).toMatch(/^sys_v1_[A-Za-z0-9_-]{43}$/);
  // Each seed carries its update alone and forms a document sync with its
  // document's own bundle and path.
  for (const [document, seed] of [
    [initialRootMetadataDocument, initialRootMetadataDocument.initialSync],
    [
      initialRosterProfileContainer.metadataDocument,
      initialRosterProfileContainer.initialMetadataSync,
    ],
    [
      initialOrganizationMetadataContainer.metadataDocument,
      initialOrganizationMetadataContainer.initialMetadataSync,
    ],
    [provisionedTrash.metadataDocument, provisionedTrash.initialMetadataSync],
  ] as const) {
    expect(Object.keys(seed)).toEqual(["outgoingUpdates"]);
    expect(seed.outgoingUpdates).toHaveLength(1);
    expect(
      isDocumentSyncRequest(documentCreateSeedSyncRequest(document, seed)),
    ).toBe(true);
  }
});
