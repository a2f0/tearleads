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

test("a bundle changed after its comparison is stored as the bytes verification saw", async () => {
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
  // The same object changes after the comparison it passed.
  Reflect.set(live.event.event, "signature", "changed");
  Reflect.set(live.state, "linkedContainerIds", ["container-2"]);
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
