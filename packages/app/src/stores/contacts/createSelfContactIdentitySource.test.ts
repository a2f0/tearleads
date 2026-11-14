import { expect, test } from "bun:test";
import { deriveStableDocumentId, Tearleads } from "@tearleads/client-sdk";

import { createSqlRuntimeBase } from "../../../test/helpers/createSqlRuntime";
import { createSelfContactIdentitySource } from "./createSelfContactIdentitySource";
import { getSelfContactLocalId } from "./selfContact";

const FINGERPRINT = "identity-source-runtime";

test("an SDK identity source cannot revive after database A-B-A", async () => {
  const runtime = await createSqlRuntimeBase("identity-source-runtime");
  const { execSql, blobStore } = runtime.infra;
  const sdk = new Tearleads({
    apiBaseUrl: "http://localhost:3001",
    blobStore,
    database: { execSql, id: "identity-source-runtime" },
    identity: { signingFingerprint: FINGERPRINT },
    identityProvisioning: "manual",
    logger: { log: () => undefined, logError: () => undefined },
    online: false,
  });
  try {
    const { view } = sdk.deviceFirst.open();
    const source = createSelfContactIdentitySource(sdk, view);
    expect(source.enabled).toBe(true);
    expect(source.isCurrent()).toBe(true);
    const identity = await source.load();
    expect(identity.localId).toBe(getSelfContactLocalId(FINGERPRINT));
    const version = sdk.runtime.version;

    sdk.database.clear();
    sdk.database.setExecSql(execSql, { id: "identity-source-runtime" });
    expect(sdk.database.execSql).toBe(execSql);
    expect(sdk.identity.signingFingerprint).toBe(FINGERPRINT);
    expect(sdk.runtime.version).toBeGreaterThan(version);
    expect(source.isCurrent()).toBe(false);
    expect(createSelfContactIdentitySource(sdk, view).isCurrent()).toBe(true);
  } finally {
    sdk.dispose();
    runtime.close();
  }
});

test("identity invalidation retains births, cross-folder relinks and placement", async () => {
  const runtime = await createSqlRuntimeBase("identity-placements");
  const sdk = new Tearleads({
    database: { execSql: runtime.infra.execSql, id: "identity-placements" },
    blobStore: runtime.infra.blobStore,
    identity: { signingFingerprint: FINGERPRINT },
    identityProvisioning: "manual",
    logger: { log: () => undefined, logError: () => undefined },
    online: false,
  });
  let stop: () => void = () => undefined;
  try {
    const { view } = sdk.deviceFirst.open();
    const source = createSelfContactIdentitySource(sdk, view);
    const canonical = await source.load();
    let invalidations = 0;
    stop = source.subscribe(() => invalidations++);
    const localId = "note-kind-alias-outside-contacts";
    const note = sdk.documents.open({
      containerId: "outside-contacts",
      initialText: "Before relink",
      localId,
    });
    expect(await note.ensureInitialized()).toBe(true);
    expect(invalidations).toBeGreaterThan(0);
    invalidations = 0;
    await note.setText("Content only");
    expect(invalidations).toBe(0);
    const other = await deriveStableDocumentId("another-stream");
    for (const [containerId, documentId] of [
      ["outside-contacts", canonical.documentId],
      ["outside-contacts", other],
      ["another-folder", other],
    ] as const) {
      invalidations = 0;
      expect(
        await note.relink({ accessEpoch: 1, containerId, documentId, localId }),
      ).not.toBeNull();
      expect(invalidations).toBeGreaterThan(0);
      expect((await source.load()).localIds.has(localId)).toBe(
        documentId === canonical.documentId,
      );
    }
    stop();
    invalidations = 0;
    expect(
      await note.relink({
        accessEpoch: 1,
        containerId: "after-unsubscribe",
        documentId: other,
        localId,
      }),
    ).not.toBeNull();
    expect(invalidations).toBe(0);
  } finally {
    stop();
    sdk.dispose();
    runtime.close();
  }
});
