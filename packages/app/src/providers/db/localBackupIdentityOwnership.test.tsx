import { expect, spyOn, test } from "bun:test";
import {
  type BlobStore,
  createMemoryBlobStore,
  Tearleads,
} from "@tearleads/client-sdk";
import {
  PERSISTENT_STORAGE_POLICY,
  type SQLiteRuntime,
} from "@tearleads/client-sdk/sqlite";
import { createTestExecSql } from "@tearleads/test-utils";
import { act, renderHook } from "@testing-library/react";
import { createDeferred } from "../../../test/helpers/databaseRuntimeFactories";
import { useGenerateKey } from "../identity/localIdentityGeneration";
import * as TearleadsProvider from "../sdk/TearleadsProvider";
import * as DatabaseProvider from "./DatabaseProvider";
import { createBackupPayload } from "./localBackupData";
import { encodeBackupFile } from "./localBackupFormat";
import { sqliteDbNameForSigningFingerprint } from "./sqliteDbName";
import { useLocalBackupOperations } from "./useLocalBackupOperations";
import {
  type DatabaseContextValue,
  useManagedSQLiteRuntime,
} from "./useManagedSQLiteRuntime";

// A ready identity database is not enough: blob ownership is installed later.
// An early restore must fail without writes; after publication, both rows and
// avatar bytes must survive a fresh SDK using the same identity namespace.
test.each([false, true])(
  "restore requires durable identity ownership: initially ready = %s",
  async (publishIdentityFirst) => {
    const source = await createTestExecSql("avatar-ownership-source");
    const target = await createTestExecSql("avatar-ownership-target");
    const avatar = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    );
    const storageKey = "ada-avatar";
    const sourceBlobs = createMemoryBlobStore();
    // Test-only namespace backing survives SDK recreation. Do not inject an
    // explicit blobStore: that opts out of the SDK's identity-store replacement.
    const namespaceStores = new Map<string, BlobStore>();
    const blobStoreFactory = (namespace: string): BlobStore => {
      let store = namespaceStores.get(namespace);
      if (!store) {
        store = createMemoryBlobStore();
        namespaceStores.set(namespace, store);
      }
      return store;
    };
    const sdk = new Tearleads({
      blobStoreFactory,
      identityProvisioning: "manual",
    });
    const initialStore = sdk.blobs.store;
    const identityDatabaseReady = createDeferred<string>();
    const releaseIdentityPublication = createDeferred();
    const generationIdRef = { current: 0 };
    const generationInFlight = { current: false };
    let initializedDbName: string | undefined;
    let initializedPersistence: string | undefined;
    let controls: DatabaseContextValue | undefined;
    let generation: Promise<boolean> | undefined;
    let coldSdk: Tearleads | undefined;
    // Exercise real SQLite statements and real managed-runtime readiness. Only
    // the worker transport/lifetime is replaced; this probe does not test OPFS.
    const createSQLiteRuntime = (): SQLiteRuntime => {
      const client: SQLiteRuntime["client"] = {
        close: async () => ({ ok: true }),
        delete: async () => ({ ok: true }),
        destroy() {},
        exec: async ({ sql, bind, rowMode }) => ({
          ok: true,
          rows: await target.execSql(sql, bind, {
            rowMode: rowMode ?? "object",
          }),
        }),
        init: async ({ dbName, persistence }) => {
          initializedDbName = dbName;
          initializedPersistence = persistence;
          return { ok: true };
        },
        ping: async () => ({ ok: true, message: "pong" }),
      };
      return {
        client,
        deleteData: async () => client.destroy(),
        destroy: () => client.destroy(),
        id: "avatar-ownership-runtime",
        terminateNow: () => client.destroy(),
      };
    };
    const log = () => {};
    const resolveCipherKey = async () => "avatar-ownership-target";
    const persistLocalIdentity = async () => {};
    const spies = [
      spyOn(TearleadsProvider, "useTearleads").mockReturnValue(sdk),
      spyOn(DatabaseProvider, "useDatabase").mockImplementation(() => {
        if (!controls) throw new Error("Database controls not mounted.");
        return controls;
      }),
      // Root-container provisioning is unrelated to backup destination capture.
      spyOn(sdk.session, "bootstrapLocalRootContainer").mockResolvedValue({
        containerId: "root",
        created: true,
      }),
    ];
    const view = renderHook(() => {
      controls = useManagedSQLiteRuntime(
        createSQLiteRuntime,
        "avatar-ownership-default",
        PERSISTENT_STORAGE_POLICY,
        resolveCipherKey,
        log,
        log,
        sdk,
      );
      const database = controls;
      const generateKey = useGenerateKey({
        ensureIdentityDatabaseReady: async (fingerprint) => {
          await database.ensureIdentityReady(fingerprint);
          identityDatabaseReady.resolve(fingerprint);
          await releaseIdentityPublication.promise;
        },
        generationIdRef,
        generationInFlight,
        persistLocalIdentity,
        tearleads: sdk,
      });
      return { generateKey, ...useLocalBackupOperations() };
    });

    try {
      await source.execSql(
        "CREATE TABLE restored_avatar_probe (id TEXT PRIMARY KEY, title TEXT NOT NULL)",
      );
      await source.execSql(
        "INSERT INTO restored_avatar_probe VALUES ('ada', 'Ada Lovelace')",
      );
      for (const table of [
        "document_pending_attachments",
        "document_attachment_blob_projection",
      ]) {
        await source.execSql(`CREATE TABLE ${table} (
          local_id TEXT NOT NULL, slot_id TEXT NOT NULL,
          storage_key TEXT NOT NULL, PRIMARY KEY (local_id, slot_id)
        )`);
        await source.execSql(`INSERT INTO ${table} VALUES (?, ?, ?)`, [
          "ada",
          "contact-avatar",
          storageKey,
        ]);
      }
      await sourceBlobs.writeBytes(storageKey, avatar);
      const payload = await createBackupPayload({
        blobStore: sourceBlobs,
        databaseId: "avatar-source",
        execSql: source.execSql,
        signingFingerprint: "source-identity",
      });
      expect(payload.missingBlobStorageKeys).toEqual([]);
      expect(payload.summary.blobCount).toBe(1);
      const text = await encodeBackupFile({ payload });
      await act(async () => {
        generation = view.result.current.generateKey();
        await identityDatabaseReady.promise;
      });
      const fingerprint = await identityDatabaseReady.promise;
      expect(initializedDbName).toBe(
        sqliteDbNameForSigningFingerprint(fingerprint),
      );
      expect(initializedPersistence).toBe(
        PERSISTENT_STORAGE_POLICY.databasePersistence,
      );
      expect(sdk.database.status).toBe("ready");
      expect(sdk.identity.signingFingerprint).toBeNull();
      expect(sdk.blobs.store).toBe(initialStore);

      if (!publishIdentityFirst) {
        await expect(
          view.result.current.restoreLocalBackup({ text }),
        ).rejects.toThrow();
        expect(await initialStore.readBytes(storageKey)).toBeNull();
        expect(
          await target.execSql(
            "SELECT name FROM sqlite_master WHERE name = 'restored_avatar_probe'",
          ),
        ).toEqual([]);
      }
      await act(async () => {
        releaseIdentityPublication.resolve();
        expect(await generation).toBe(true);
      });
      const summary = await view.result.current.restoreLocalBackup({ text });
      expect(summary.blobCount).toBe(1);
      expect(
        await target.execSql("SELECT * FROM restored_avatar_probe"),
      ).toEqual([{ id: "ada", title: "Ada Lovelace" }]);
      expect(await sdk.blobs.store.readBytes(storageKey)).toEqual(avatar);

      expect(sdk.identity.signingFingerprint).toBe(fingerprint);
      expect(sdk.blobs.store).not.toBe(initialStore);
      expect(await initialStore.readBytes(storageKey)).toBeNull();
      coldSdk = new Tearleads({
        blobStoreFactory,
        identityProvisioning: "manual",
      });
      await coldSdk.identity.setKeyPairs({
        encapsulationKeyPair: sdk.identity.encapsulationKeyPair,
        signingFingerprint: fingerprint,
        signingKeyPair: sdk.identity.signingKeyPair,
      });
      expect(await coldSdk.blobs.store.readBytes(storageKey)).toEqual(avatar);
      expect(
        await target.execSql(
          "SELECT storage_key FROM document_attachment_blob_projection WHERE local_id = 'ada'",
        ),
      ).toEqual([{ storage_key: storageKey }]);
    } finally {
      releaseIdentityPublication.resolve();
      await generation;
      view.unmount();
      for (const spy of spies) spy.mockRestore();
      coldSdk?.dispose();
      sdk.dispose();
      source.close();
      target.close();
    }
  },
);
