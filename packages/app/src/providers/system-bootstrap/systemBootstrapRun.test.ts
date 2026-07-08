import { expect, test } from "bun:test";
import type { ContainerContentsStore, Tearleads } from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { UserSystemContainer } from "../../stores/systemContainers";
import type { RuntimeSnapshot } from "../sdk/TearleadsProvider";
import { runSystemBootstrap } from "./systemBootstrapRun";

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
    },
    state: {
      containerId: "root-container-id",
    },
  } as RuntimeSnapshot;
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
