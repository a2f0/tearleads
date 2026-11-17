import { expect, test } from "bun:test";
import type { AccessManifestCheckpoint } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { toServedAccessManifestBundle } from "@tearleads/validators/util";
import { openPrincipalPolicyBundleReader } from "../../persistence/principalPolicy/principalPolicyBundleRepository";
import {
  createProjectionCheckpointContext,
  observeVerifiedProjectionBundles,
} from "./checkpointContext";
import {
  matchesVerifiedBundleBytes,
  recordVerifiedBundleBytes,
} from "./verifiedBundleBytes";

const MANIFEST_HASH = "a".repeat(64);

function documentBundle() {
  const signed = {
    version: 1,
    organizationId: "organization-1",
    epoch: 1,
    previousManifestHash: null,
    eventHash: "b".repeat(64),
  };
  return {
    event: {
      body: { eventType: "document.link" },
      event: { signature: "signed" },
      eventHash: signed.eventHash,
    },
    manifest: { ...signed, objectKind: "document", objectId: "document-1" },
    manifestHash: MANIFEST_HASH,
    state: {
      ...signed,
      documentId: "document-1",
      linkedContainerIds: ["container-1"],
    },
  };
}

test("a bundle that matched is frozen as the verified copy", async () => {
  const checkpoint: AccessManifestCheckpoint = {
    objectKind: "document",
    objectId: "document-1",
    organizationId: "organization-1",
    epoch: 1,
    manifestHash: MANIFEST_HASH,
  };
  const verified = { checkpoint };
  const original = documentBundle();
  recordVerifiedBundleBytes(verified, original);
  const live = documentBundle();
  expect(matchesVerifiedBundleBytes(verified, live)).toBe(true);
  // The same object can no longer change after the comparison it passed.
  expect(Reflect.set(live.event.event, "signature", "changed")).toBe(false);
  expect(Reflect.set(live.state, "linkedContainerIds", [])).toBe(false);
  const database = await createTestExecSql("verified-bundle-snapshot");
  try {
    const context = createProjectionCheckpointContext({
      execSql: database.execSql,
      openPrincipalPolicyBundleReader,
    });
    observeVerifiedProjectionBundles(
      context,
      new Map([[MANIFEST_HASH, live]]),
      new Map([[MANIFEST_HASH, verified]]),
    );
    expect(context.verifiedBundles).toEqual([
      { bundle: toServedAccessManifestBundle(original), checkpoint },
    ]);
  } finally {
    database.close();
  }
});

test("a bundle changed after it was observed is stored as observed", async () => {
  const checkpoint: AccessManifestCheckpoint = {
    objectKind: "document",
    objectId: "document-1",
    organizationId: "organization-1",
    epoch: 1,
    manifestHash: MANIFEST_HASH,
  };
  const verified = { checkpoint };
  const original = documentBundle();
  recordVerifiedBundleBytes(verified, original);
  const live = documentBundle();
  const database = await createTestExecSql("verified-bundle-observed");
  try {
    const context = createProjectionCheckpointContext({
      execSql: database.execSql,
      openPrincipalPolicyBundleReader,
    });
    observeVerifiedProjectionBundles(
      context,
      new Map([[MANIFEST_HASH, live]]),
      new Map([[MANIFEST_HASH, verified]]),
    );
    // Persistence awaits before it serializes what was observed.
    Reflect.set(live.event.event, "signature", "changed");
    Reflect.set(live.manifest, "epoch", 2);
    Reflect.set(live.state, "linkedContainerIds", ["container-2"]);
    expect(context.verifiedBundles).toEqual([
      { bundle: toServedAccessManifestBundle(original), checkpoint },
    ]);
  } finally {
    database.close();
  }
});

test("a bundle read twice stores the copy it compared", async () => {
  const checkpoint: AccessManifestCheckpoint = {
    objectKind: "document",
    objectId: "document-1",
    organizationId: "organization-1",
    epoch: 1,
    manifestHash: MANIFEST_HASH,
  };
  const verified = { checkpoint };
  const original = documentBundle();
  recordVerifiedBundleBytes(verified, original);
  const live = documentBundle();
  let reads = 0;
  // A state whose second read differs from its first.
  Object.defineProperty(live.state, "linkedContainerIds", {
    enumerable: true,
    get: () => {
      reads += 1;
      return reads === 1 ? ["container-1"] : ["container-2"];
    },
  });
  const database = await createTestExecSql("verified-bundle-read-twice");
  try {
    const context = createProjectionCheckpointContext({
      execSql: database.execSql,
      openPrincipalPolicyBundleReader,
    });
    observeVerifiedProjectionBundles(
      context,
      new Map([[MANIFEST_HASH, live]]),
      new Map([[MANIFEST_HASH, verified]]),
    );
    expect(context.verifiedBundles).toEqual([
      { bundle: toServedAccessManifestBundle(original), checkpoint },
    ]);
  } finally {
    database.close();
  }
});
