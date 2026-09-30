import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  type AccessManifestVerificationMarkerStore,
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
