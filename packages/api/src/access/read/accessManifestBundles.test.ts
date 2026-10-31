import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { accessEvents, accessManifests } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { registerServiceUser } from "../../../test/helpers/registerServiceUser";
import {
  forgetTransactionAccessManifestBundles,
  updateAccessManifestVerificationMacs,
} from "../write/accessManifestStore";
import {
  getAccessManifestBundle,
  getAccessManifestBundles,
} from "./accessManifestStore";

test("manifest bundles load their signed events in one query and preserve missing hashes", async () => {
  const { registration } = await registerServiceUser();
  const expected = [
    registration.rootMetadataDocument.accessManifest,
    registration.organizationMetadataContainer.metadataDocument.accessManifest,
  ];
  const hashes = expected.map((bundle) => String(bundle.manifestHash));
  const absent = "0".repeat(64);
  const counter = { statements: 0 };
  const bundles = await withDatabaseStatementCounter(counter, () =>
    getAccessManifestBundles([...hashes, hashes[0] ?? absent, absent], db),
  );
  expect(counter.statements).toBe(1);
  expect(bundles.size).toBe(2);
  for (const bundle of expected) {
    expect(bundles.get(bundle.manifestHash)).toMatchObject(bundle);
  }
  expect(await getAccessManifestBundle(absent, db)).toBeNull();
  const emptyCounter = { statements: 0 };
  expect(
    await withDatabaseStatementCounter(emptyCounter, () =>
      getAccessManifestBundles([], db),
    ),
  ).toEqual(new Map());
  expect(emptyCounter.statements).toBe(0);
});

test("a manifest with a missing event remains an integrity error", async () => {
  const { registration } = await registerServiceUser();
  const manifestHash = String(
    registration.rootMetadataDocument.accessManifest.manifestHash,
  );
  const bundle = await getAccessManifestBundle(manifestHash, db);
  if (!bundle) throw new Error("Missing manifest fixture");
  await db
    .delete(accessEvents)
    .where(eq(accessEvents.eventHash, bundle.event.eventHash));
  await expect(getAccessManifestBundle(manifestHash, db)).rejects.toThrow(
    "Access event not found",
  );
  await expect(getAccessManifestBundles([manifestHash], db)).rejects.toThrow(
    "Access event not found",
  );
});

class UndoFixture extends Error {}

test("a transaction reads each stored manifest bundle once", async () => {
  const { registration } = await registerServiceUser();
  const first = String(
    registration.rootMetadataDocument.accessManifest.manifestHash,
  );
  const second = String(
    registration.organizationMetadataContainer.metadataDocument.accessManifest
      .manifestHash,
  );
  const absent = "0".repeat(64);
  const count = async <T>(work: () => Promise<T>) => {
    const counter = { statements: 0 };
    const result = await withDatabaseStatementCounter(counter, work);
    return { result, statements: counter.statements };
  };
  await db
    .transaction(async (tx) => {
      expect(
        (await count(() => getAccessManifestBundle(first, tx))).statements,
      ).toBe(1);
      // Only the hashes not yet read are selected; a miss stays unread.
      const both = await count(() =>
        getAccessManifestBundles([first, second, absent], tx),
      );
      expect(both.statements).toBe(1);
      expect([...both.result.keys()].sort()).toEqual([first, second].sort());
      const again = await count(() =>
        getAccessManifestBundles([first, second, absent], tx),
      );
      expect(again.statements).toBe(1);
      expect(
        (await count(() => getAccessManifestBundles([first, second], tx)))
          .statements,
      ).toBe(0);

      // The transaction's own marker write reaches the memo.
      await updateAccessManifestVerificationMacs(new Map([[first, "mac"]]), tx);
      expect((await getAccessManifestBundle(first, tx))?.verificationMac).toBe(
        "mac",
      );
      // Deleting manifests forgets the memo.
      forgetTransactionAccessManifestBundles(tx);
      await tx
        .delete(accessManifests)
        .where(eq(accessManifests.manifestHash, second));
      expect(await getAccessManifestBundle(second, tx)).toBeNull();
      throw new UndoFixture();
    })
    .catch((error: unknown) => {
      if (!(error instanceof UndoFixture)) throw error;
    });
  // The root executor keeps no memo.
  expect(
    (await count(() => getAccessManifestBundle(first, db))).statements,
  ).toBe(1);
  expect(
    (await count(() => getAccessManifestBundle(first, db))).statements,
  ).toBe(1);
});

test("a malformed bundle is not memoized and fails again in the same transaction", async () => {
  const { registration } = await registerServiceUser();
  const manifestHash = String(
    registration.rootMetadataDocument.accessManifest.manifestHash,
  );
  const bundle = await getAccessManifestBundle(manifestHash, db);
  if (!bundle) throw new Error("Missing manifest fixture");
  await db
    .delete(accessEvents)
    .where(eq(accessEvents.eventHash, bundle.event.eventHash));
  await db.transaction(async (tx) => {
    await expect(getAccessManifestBundle(manifestHash, tx)).rejects.toThrow(
      "Access event not found",
    );
    // Skipped as unreadable, then read and refused again.
    expect(await getAccessManifestBundles([manifestHash], tx, true)).toEqual(
      new Map(),
    );
    await expect(getAccessManifestBundle(manifestHash, tx)).rejects.toThrow(
      "Access event not found",
    );
  });
});
