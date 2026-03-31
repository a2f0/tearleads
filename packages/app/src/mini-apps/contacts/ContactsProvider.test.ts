import { expect, test } from "bun:test";
import { type ContactsRuntime, createContactsStore } from "./ContactsProvider";
import type { ContactsPersistence } from "./contactsPersistence";

interface StoredContact {
  encapsulationPublicKey: string;
  userId: string;
}

function createContactsPersistence(): ContactsPersistence {
  const contacts = new Map<string, StoredContact>();

  return {
    async ensureSchema() {},
    async listEntries() {
      return [...contacts.values()].sort((left, right) =>
        left.userId.localeCompare(right.userId),
      );
    },
    async removeEntry(_execSql, userId) {
      contacts.delete(userId);
    },
    async saveEntry(_execSql, entry) {
      contacts.set(entry.userId, entry);
    },
  };
}

function createRuntime(userIdToImport?: string): ContactsRuntime {
  return {
    apiClient: {
      getEncapsulationKey: async (userId: string) => {
        if (userId !== userIdToImport) {
          return null;
        }

        return {
          encapsulationPublicKey: `${userId}-key`,
          userId,
        };
      },
    },
    dbStatus: "ready",
    domainScope: {},
    execSql: async () => [],
    log: () => {},
  };
}

async function waitForStoreReady(
  store: ReturnType<typeof createContactsStore>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (store.getSnapshot().ready) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error("Contacts store did not become ready.");
}

test("contacts store reloads persisted address book entries", async () => {
  const persistence = createContactsPersistence();

  const firstRuntime = createRuntime("peer-user-1");
  const firstStore = createContactsStore(firstRuntime, persistence);
  firstStore.updateRuntime(firstRuntime);
  await waitForStoreReady(firstStore);

  expect(firstStore.getSnapshot()).toEqual({
    entries: [],
    ready: true,
  });

  await firstStore.importKey("peer-user-1");

  expect(firstStore.getSnapshot()).toEqual({
    entries: [
      {
        encapsulationPublicKey: "peer-user-1-key",
        userId: "peer-user-1",
      },
    ],
    ready: true,
  });

  const secondRuntime = createRuntime();
  const secondStore = createContactsStore(secondRuntime, persistence);
  secondStore.updateRuntime(secondRuntime);
  await waitForStoreReady(secondStore);

  expect(secondStore.getSnapshot()).toEqual({
    entries: [
      {
        encapsulationPublicKey: "peer-user-1-key",
        userId: "peer-user-1",
      },
    ],
    ready: true,
  });

  await secondStore.removeKey("peer-user-1");

  const thirdRuntime = createRuntime();
  const thirdStore = createContactsStore(thirdRuntime, persistence);
  thirdStore.updateRuntime(thirdRuntime);
  await waitForStoreReady(thirdStore);

  expect(thirdStore.getSnapshot()).toEqual({
    entries: [],
    ready: true,
  });
});
