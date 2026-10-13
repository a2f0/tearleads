import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { accessEvents } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { registerServiceUser } from "../../../test/helpers/registerServiceUser";
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
