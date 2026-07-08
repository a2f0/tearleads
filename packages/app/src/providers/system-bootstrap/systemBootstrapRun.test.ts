import { expect, test } from "bun:test";
import type {
  ContainerContentsStore,
  ContainerNode,
  Tearleads,
} from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { UserSystemContainer } from "../../stores/systemContainers";
import type { RuntimeSnapshot } from "../sdk/TearleadsProvider";
import {
  createSystemBootstrapTargetKey,
  runSystemBootstrap,
} from "./systemBootstrapRun";
import { ensureSystemBootstrapContainer } from "./systemContainerBootstrap";

const CONTACTS_SLOT =
  "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const TRASH_SLOT =
  "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;

const contactsSystemContainer: UserSystemContainer = {
  icon: null,
  kind: "contacts",
  name: "Contacts",
  provisionedAtOrganizationCreation: false,
  systemSlot: CONTACTS_SLOT,
};

const trashSystemContainer: UserSystemContainer = {
  icon: "trash",
  kind: "trash",
  name: "Trash",
  provisionedAtOrganizationCreation: true,
  systemSlot: TRASH_SLOT,
};

function appData(): RuntimeSnapshot {
  return {
    auth: {
      isAuthenticated: true,
      organizationId: "organization-id",
      userId: "user-id",
    },
    crypto: {
      signingFingerprint: "signing-fingerprint",
    },
    infra: {
      dbId: "db-id",
    },
    state: {
      containerId: "root-container-id",
    },
  } as RuntimeSnapshot;
}

function contactContainerNode(
  status: ContainerNode["syncState"]["status"],
): ContainerNode {
  return {
    id: "contacts-container-id",
    kind: "container",
    name: "Contacts",
    organizationId: "organization-id",
    parentId: "root-container-id",
    syncState: {
      lastError: null,
      pendingAttachmentBytes: 0,
      pendingAttachmentCount: 0,
      pendingUpdateCount: status === "pending" ? 1 : 0,
      status,
    },
    systemSlot: CONTACTS_SLOT,
  };
}

function storeWithEnsureCounter(input: {
  readonly calls: string[];
}): ContainerContentsStore {
  return {
    ensureSystemContainer: async (systemSlot: ContainerSystemSlot) => {
      input.calls.push(systemSlot);
      return null;
    },
    getSnapshot: () => ({
      nodes: [],
      ready: true,
    }),
  } as unknown as ContainerContentsStore;
}

test("system bootstrap skips Contacts when contact bootstrap is disabled", async () => {
  const calls: string[] = [];

  await expect(
    runSystemBootstrap({
      appData: appData(),
      bootstrapContacts: false,
      containerContentsStore: storeWithEnsureCounter({ calls }),
      systemContainers: [contactsSystemContainer, trashSystemContainer],
      targetKey: "target",
      tearleads: {} as Tearleads,
    }),
  ).resolves.toBe(true);
  expect(calls).toEqual([]);
});

test("system bootstrap still attempts Contacts when contact bootstrap is enabled", async () => {
  const calls: string[] = [];

  await expect(
    runSystemBootstrap({
      appData: appData(),
      bootstrapContacts: true,
      containerContentsStore: storeWithEnsureCounter({ calls }),
      systemContainers: [contactsSystemContainer, trashSystemContainer],
      targetKey: "target",
      tearleads: {} as Tearleads,
    }),
  ).resolves.toBe(false);
  expect(calls).toEqual([CONTACTS_SLOT]);
});

test("system bootstrap target does not re-key while Contacts create is pending", () => {
  const localOnlyKey = createSystemBootstrapTargetKey({
    appData: appData(),
    bootstrapContacts: true,
    contactsContainer: contactContainerNode("local-only"),
    systemContainers: [contactsSystemContainer],
  });
  const pendingKey = createSystemBootstrapTargetKey({
    appData: appData(),
    bootstrapContacts: true,
    contactsContainer: contactContainerNode("pending"),
    systemContainers: [contactsSystemContainer],
  });
  const syncedKey = createSystemBootstrapTargetKey({
    appData: appData(),
    bootstrapContacts: true,
    contactsContainer: contactContainerNode("synced"),
    systemContainers: [contactsSystemContainer],
  });

  expect(pendingKey).toBe(localOnlyKey);
  expect(syncedKey).not.toBe(localOnlyKey);
});

test("system bootstrap target waits for auth before remote self-contact bootstrap", () => {
  const unauthenticatedAppData = {
    ...appData(),
    auth: {
      isAuthenticated: false,
      organizationId: null,
      userId: null,
    },
  } as RuntimeSnapshot;

  const localOnlyKey = createSystemBootstrapTargetKey({
    appData: unauthenticatedAppData,
    bootstrapContacts: true,
    contactsContainer: contactContainerNode("local-only"),
    systemContainers: [contactsSystemContainer],
  });
  const syncedKey = createSystemBootstrapTargetKey({
    appData: unauthenticatedAppData,
    bootstrapContacts: true,
    contactsContainer: contactContainerNode("synced"),
    systemContainers: [contactsSystemContainer],
  });

  expect(syncedKey).toBe(localOnlyKey);
});

test("system bootstrap does not promote an existing local-only system container", async () => {
  const existing = contactContainerNode("local-only");
  const calls: string[] = [];
  const store = {
    ensureSystemContainer: async (systemSlot: ContainerSystemSlot) => {
      calls.push(systemSlot);
      return existing;
    },
    getSnapshot: () => ({
      nodes: [existing],
      ready: true,
    }),
  } as unknown as ContainerContentsStore;

  await expect(
    ensureSystemBootstrapContainer({
      currentOrganizationId: "organization-id",
      currentRootContainerId: "root-container-id",
      store,
      systemContainer: contactsSystemContainer,
    }),
  ).resolves.toBe(existing);
  expect(calls).toEqual([]);
});
