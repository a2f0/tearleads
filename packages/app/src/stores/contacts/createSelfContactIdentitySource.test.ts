import { expect, test } from "bun:test";
import { Tearleads } from "@tearleads/client-sdk";
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
    const source = createSelfContactIdentitySource(sdk, () => () => undefined);
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
    expect(
      createSelfContactIdentitySource(sdk, () => () => undefined).isCurrent(),
    ).toBe(true);
  } finally {
    sdk.dispose();
    runtime.close();
  }
});
