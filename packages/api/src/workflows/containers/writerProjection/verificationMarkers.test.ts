import { expect, spyOn, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { accessManifests } from "@tearleads/api-shared/schema";
import type { AnyVerifiedPrincipalPolicy } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { registerServiceUser } from "../../../../test/helpers/registerServiceUser";
import { updateAccessManifestVerificationMacs } from "../../../access/write/accessManifestStore";
import { createContainerWriterProjectionContext } from "./context";
import {
  type AccessManifestVerificationMarkerStore,
  clearProcessVerificationMarkers,
  databaseVerificationMarkerStore,
  flushVerificationMarkersAfterRead,
} from "./verificationMarkers";

test("a failed read write-back is reported, not returned", async () => {
  const failure = new Error("marker table unavailable");
  const store: AccessManifestVerificationMarkerStore = {
    load: async () => ({ table: null, process: null }),
    seed: () => {},
    save: async () => {},
    flush: async () => {
      throw failure;
    },
  };
  const logged = spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(
      flushVerificationMarkersAfterRead(store, db),
    ).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith(
      "Failed to write access manifest verification markers:",
      failure,
    );
  } finally {
    logged.mockRestore();
  }
});

/** A stored manifest with no marker anywhere, as after a rotated secret. */
async function storedManifestHash(): Promise<string> {
  const { registration } = await registerServiceUser();
  const manifestHash = String(registration.rootMetadataDocument.manifestHash);
  await db
    .update(accessManifests)
    .set({ verificationMac: null })
    .where(eq(accessManifests.manifestHash, manifestHash));
  clearProcessVerificationMarkers();
  return manifestHash;
}

test("verification that used request evidence records no marker anywhere", async () => {
  // Only the evidence's presence matters to the store.
  const evidence = [{} as AnyVerifiedPrincipalPolicy];
  const markers = createContainerWriterProjectionContext(
    db,
    evidence,
  ).verificationMarkers;
  const manifestHash = await storedManifestHash();
  await markers.save(manifestHash, "mac");
  await markers.flush();
  expect(
    await databaseVerificationMarkerStore(db, { recordsMarkers: true }).load(
      manifestHash,
    ),
  ).toEqual({ table: null, process: null });
});

test("verification from stored evidence alone records its marker", async () => {
  const markers =
    createContainerWriterProjectionContext(db).verificationMarkers;
  const manifestHash = await storedManifestHash();
  await markers.save(manifestHash, "mac");
  await markers.flush();
  expect(
    await databaseVerificationMarkerStore(db, { recordsMarkers: true }).load(
      manifestHash,
    ),
  ).toEqual({ table: "mac", process: "mac" });
});

test("a seeded marker is checked without a query and never replaces a saved one", async () => {
  const manifestHash = await storedManifestHash();
  await updateAccessManifestVerificationMacs(
    new Map([[manifestHash, "stored"]]),
    db,
  );
  const markers = databaseVerificationMarkerStore(db, {
    recordsMarkers: true,
  });
  markers.seed({ manifestHash, verificationMac: "seeded" });
  const counter = { statements: 0 };
  const seeded = await withDatabaseStatementCounter(counter, () =>
    markers.load(manifestHash),
  );
  expect(counter.statements).toBe(0);
  expect(seeded.table).toBe("seeded");
  await markers.save(manifestHash, "saved");
  markers.seed({ manifestHash, verificationMac: null });
  expect((await markers.load(manifestHash)).table).toBe("saved");
  // An unseeded check reads the row's marker column.
  const fresh = databaseVerificationMarkerStore(db, { recordsMarkers: true });
  expect((await fresh.load(manifestHash)).table).toBe("stored");
});
