import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import {
  isDocumentSyncRequest,
  type RegistrationRequest,
} from "@tearleads/validators/request";
import { type RegistrationApi, registerIdentity } from "./registerIdentity";

test("registration includes system metadata in the personal-org transaction", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  let initialSystemContainers: RegistrationRequest["initialSystemContainers"];

  const response = await registerIdentity({
    apiClient: {
      registerUser: async (
        ...args: Parameters<RegistrationApi["registerUser"]>
      ) => {
        initialSystemContainers = args[14];
        return null;
      },
    },
    containerId: crypto.randomUUID(),
    encapsulationKeyPair,
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
  expect(initialSystemContainers).toHaveLength(1);
  const provisionedTrash = initialSystemContainers?.[0];
  expect(provisionedTrash?.systemSlot).toMatch(/^sys_v1_[A-Za-z0-9_-]{43}$/);
  expect(isDocumentSyncRequest(provisionedTrash?.initialMetadataSync)).toBe(
    true,
  );
  expect(provisionedTrash?.initialMetadataSync.outgoingUpdates).toHaveLength(1);
});
