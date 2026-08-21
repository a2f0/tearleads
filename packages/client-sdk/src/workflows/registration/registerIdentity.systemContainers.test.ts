import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@symcrypt/crypto";
import { isDocumentSyncRequest } from "@symcrypt/validators/request";
import { type RegistrationApi, registerIdentity } from "./registerIdentity";

test("registration includes initial metadata in the personal-org transaction", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  type RegisterUserParameters = Parameters<RegistrationApi["registerUser"]>;
  let initialRootMetadataDocument: RegisterUserParameters[9] | undefined;
  let initialRosterProfileContainer: RegisterUserParameters[10];
  let initialOrganizationMetadataContainer: RegisterUserParameters[12];
  let initialSystemContainers: RegisterUserParameters[14];

  const response = await registerIdentity({
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
          namespace: "symcrypt.explorer",
          projectorId: "explorer",
          slotId: "trash",
          version: 1,
        },
      },
    ],
    signingKeyPair,
  });

  expect(response).toBeNull();
  const initialMetadataSyncs = [
    initialRootMetadataDocument?.initialSync,
    initialRosterProfileContainer?.initialMetadataSync,
    initialOrganizationMetadataContainer?.initialMetadataSync,
  ];
  for (const initialMetadataSync of initialMetadataSyncs) {
    expect(isDocumentSyncRequest(initialMetadataSync)).toBe(true);
    expect(initialMetadataSync?.outgoingUpdates).toHaveLength(1);
  }
  expect(initialSystemContainers).toHaveLength(1);
  const provisionedTrash = initialSystemContainers?.[0];
  expect(provisionedTrash?.systemSlot).toMatch(/^sys_v1_[A-Za-z0-9_-]{43}$/);
  expect(isDocumentSyncRequest(provisionedTrash?.initialMetadataSync)).toBe(
    true,
  );
  expect(provisionedTrash?.initialMetadataSync.outgoingUpdates).toHaveLength(1);
});
