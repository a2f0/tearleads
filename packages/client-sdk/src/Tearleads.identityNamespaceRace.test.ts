import { expect, test } from "bun:test";
import { createIdentitySeedPhraseFromEntropy } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { quietLogger } from "../test/helpers/clientTestSupport";
import { createMemoryBlobStore, Tearleads } from ".";
import { createExecSql } from "./sqlite";

const seedPhrase = createIdentitySeedPhraseFromEntropy(
  new Uint8Array(32).fill(17),
);

test.each([
  "useIdentityNamespace",
  "useEphemeralStore",
  "updateIdentityNamespace",
  "destroy",
] as const)(
  "%s preserves selected state when identity-scoped generation is pending",
  async (change) => {
    const { close, execSql } = await createTestExecSql(
      `identity-namespace-race-${change}`,
    );
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const stores: ReturnType<typeof createMemoryBlobStore>[] = [];
    const sdk = new Tearleads({
      blobStoreFactory: () => {
        const store = createMemoryBlobStore();
        stores.push(store);
        return store;
      },
      database: {
        id: `identity-namespace-race-${change}`,
        execSql: createExecSql({
          exec: async ({ sql, bind, rowMode }) => {
            entered.resolve();
            await resume.promise;
            return {
              rows: await execSql(sql, bind, { rowMode: rowMode ?? "object" }),
            };
          },
        }),
      },
      logger: quietLogger,
    });
    let notifications = 0;
    const unsubscribe = sdk.identity.subscribe(() => {
      notifications += 1;
    });
    let generation: ReturnType<typeof sdk.identity.generate> | undefined;
    try {
      await sdk.identity.importSeedPhrase(seedPhrase);
      const previousIdentity = sdk.identity.snapshot;
      const previousStore = sdk.blobs.store;
      generation = sdk.identity.generate();
      await Promise.race([
        entered.promise,
        generation.then(() => {
          throw new Error("Generation finished without reaching the SQL gate");
        }),
      ]);
      // A distinct identity store is prepared, but must not become active.
      expect(stores).toHaveLength(2);
      expect(stores[1]).not.toBe(previousStore);
      expect(sdk.blobs.store).toBe(previousStore);

      if (change === "destroy") sdk.identity.destroy();
      else if (change === "useEphemeralStore") sdk.blobs.useEphemeralStore();
      else sdk.blobs[change]("explicit-host-namespace");

      const selectedStore = sdk.blobs.store;
      const selectedIdentity = sdk.identity.snapshot;
      const notificationCount = notifications;
      resume.resolve();
      await expect(generation).rejects.toThrow("superseded");
      expect(sdk.blobs.store).toBe(selectedStore);
      expect(sdk.identity.snapshot).toBe(selectedIdentity);
      expect(notifications).toBe(notificationCount);
      expect(sdk.session.containerId).toBeNull();
      if (change === "destroy") {
        expect(sdk.identity.signingKeyPair).toBeNull();
        expect(sdk.identity.encapsulationKeyPair).toBeNull();
        expect(sdk.identity.signingFingerprint).toBeNull();
      } else {
        expect(sdk.identity.snapshot).toBe(previousIdentity);
      }
    } finally {
      resume.resolve();
      await generation?.catch(() => undefined);
      unsubscribe();
      sdk.dispose();
      close();
    }
  },
);
