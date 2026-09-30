import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { accessManifestVerifications } from "@tearleads/api-shared/schema";
import type { AnyVerifiedPrincipalPolicy } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { createContainerWriterProjectionContext } from "./context";
import {
  type AccessManifestVerificationMarkerStore,
  databaseVerificationMarkerStore,
  flushVerificationMarkersAfterRead,
} from "./verificationMarkers";

test("a failed read write-back is reported, not returned", async () => {
  const failure = new Error("marker table unavailable");
  const store: AccessManifestVerificationMarkerStore = {
    load: async () => ({ table: null, process: null }),
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

test("verification that used request evidence records no marker anywhere", async () => {
  // Only the evidence's presence matters to the store.
  const evidence = [{} as AnyVerifiedPrincipalPolicy];
  const markers = createContainerWriterProjectionContext(
    db,
    evidence,
  ).verificationMarkers;
  const manifestHash = `evidence-${crypto.randomUUID()}`;
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
  const manifestHash = `stored-${crypto.randomUUID()}`;
  await markers.save(manifestHash, "mac");
  await markers.flush();
  expect(
    await databaseVerificationMarkerStore(db, { recordsMarkers: true }).load(
      manifestHash,
    ),
  ).toEqual({ table: "mac", process: "mac" });
  await db
    .delete(accessManifestVerifications)
    .where(eq(accessManifestVerifications.manifestHash, manifestHash));
});
