import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { deriveOrganizationTrashSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { LEGAL_TERMS_VERSION } from "@tearleads/validators/legalTerms";
import {
  documentCreateSeedSyncRequest,
  isDocumentSyncRequest,
} from "@tearleads/validators/request";
import { deriveSystemContainerId } from "../container-contents";
import { deriveRegistrationOrganizationId } from "./bootstrapRootContainer";
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

  const rootContainerId = crypto.randomUUID();
  const plannedOrganizationId =
    await deriveRegistrationOrganizationId(rootContainerId);
  const response = await registerIdentity({
    acceptedLegalTermsVersion: LEGAL_TERMS_VERSION,
    identityTrustDomain: "https://api.example.test",
    apiClient: {
      registerUser: async (
        ...args: Parameters<RegistrationApi["registerUser"]>
      ) => {
        expect(args[1]).toBe(plannedOrganizationId);
        initialRootMetadataDocument = args[9];
        initialRosterProfileContainer = args[10];
        initialOrganizationMetadataContainer = args[12];
        initialSystemContainers = args[14];
        return null;
      },
    },
    containerId: rootContainerId,
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
        slotNamespace: "tearleads.organization-trash",
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
  const systemSlot = deriveOrganizationTrashSystemSlot(plannedOrganizationId);
  expect(provisionedTrash.systemSlot).toBe(systemSlot);
  expect(Reflect.get(provisionedTrash.container.event, "objectId")).toBe(
    await deriveSystemContainerId({
      parentContainerId: rootContainerId,
      systemSlot,
    }),
  );

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
