import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { accessManifestVerifications } from "@tearleads/api-shared/schema";
import { inArray } from "drizzle-orm";
import { selectAccessManifestVerificationMacs } from "../read/accessManifestStore";
import { upsertAccessManifestVerificationMacs } from "./accessManifestStore";

test("verification MACs round-trip across several statement batches", async () => {
  const macs = new Map(
    Array.from({ length: 1_201 }, (_, index) => [
      `batch-${crypto.randomUUID()}`,
      `mac-${index}`,
    ]),
  );
  const hashes = [...macs.keys()];
  try {
    await upsertAccessManifestVerificationMacs(macs, db);
    expect(await selectAccessManifestVerificationMacs(hashes, db)).toEqual(
      macs,
    );
    // Replacing is idempotent per row, including one row per statement.
    const replaced = new Map(hashes.map((hash) => [hash, `new-${hash}`]));
    await upsertAccessManifestVerificationMacs(replaced, db, 1);
    expect(await selectAccessManifestVerificationMacs(hashes, db)).toEqual(
      replaced,
    );
  } finally {
    await db
      .delete(accessManifestVerifications)
      .where(inArray(accessManifestVerifications.manifestHash, hashes));
  }
}, 60_000);
