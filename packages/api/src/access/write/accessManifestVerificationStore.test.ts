import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { registerServiceUser } from "../../../test/helpers/registerServiceUser";
import {
  getAccessManifestBundles,
  selectAccessManifestVerificationMac,
} from "../read/accessManifestStore";
import { updateAccessManifestVerificationMacs } from "./accessManifestStore";

test("verification MACs live on their manifest rows and load with them", async () => {
  const { registration } = await registerServiceUser();
  const hashes = [
    registration.rootMetadataDocument.manifestHash,
    registration.organizationMetadataContainer.metadataDocument.manifestHash,
  ];
  const absent = "0".repeat(64);
  const macs = new Map(
    [...hashes, absent].map((hash) => [hash, `mac-${hash}`]),
  );
  const counter = { statements: 0 };
  await withDatabaseStatementCounter(counter, () =>
    updateAccessManifestVerificationMacs(macs, db),
  );
  // One single-row update per marker, in hash order.
  expect(counter.statements).toBe(3);
  for (const hash of hashes)
    expect(await selectAccessManifestVerificationMac(hash, db)).toBe(
      `mac-${hash}`,
    );
  // A manifest that is not stored gains no marker.
  expect(await selectAccessManifestVerificationMac(absent, db)).toBeNull();
  // The bundle load carries the marker, so checking it needs no second read.
  const bundles = await getAccessManifestBundles(hashes, db);
  for (const hash of hashes)
    expect(bundles.get(hash)?.verificationMac).toBe(`mac-${hash}`);
  // Replacing a marker from older rules or another secret is idempotent.
  const replaced = new Map(hashes.map((hash) => [hash, `new-${hash}`]));
  await updateAccessManifestVerificationMacs(replaced, db);
  await updateAccessManifestVerificationMacs(replaced, db);
  for (const hash of hashes)
    expect(await selectAccessManifestVerificationMac(hash, db)).toBe(
      `new-${hash}`,
    );
});
