import { describe, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { quietLogger } from "../../test/helpers/clientTestSupport";
import { loadContainers } from "../data/persistence/containers/containerPersistence";
import { Tearleads } from "./Tearleads";

async function waitForProvisionedIdentity(sdk: Tearleads): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (sdk.identity.signingFingerprint && sdk.session.containerId) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Timed out waiting for identity provisioning.");
}

describe("Tearleads constructor", () => {
  test("creates a minimal SDK instance without host adapters", () => {
    const sdk = new Tearleads();

    expect(sdk.database.snapshot).toEqual({
      client: null,
      execSql: null,
      id: null,
      status: "idle",
    });
    expect(sdk.identity.snapshot).toEqual({
      encapsulationKeyPair: null,
      seedPhrase: null,
      signingFingerprint: null,
      signingKeyPair: null,
    });
    expect(sdk.session.containerId).toBeNull();
    expect(sdk.documents.open).toBeFunction();
    expect(sdk.containerContents.openTree).toBeFunction();
    expect(sdk.deviceFirst.open).toBeFunction();
    expect("openView" in sdk.deviceFirst).toBe(false);
    expect("reconciler" in sdk.deviceFirst).toBe(false);
    expect(sdk.organizations.loadDirectoryAndGroups).toBeFunction();
  });

  test("device-first reads, writes, and reconciler are shared across a domain scope", () => {
    const sdk = new Tearleads();

    // Every mini-app in the same storage/identity context shares the local tree
    // mutation store, projection view, and background reconciler rather than
    // opening nominally separate read and write seams.
    const contents = sdk.deviceFirst.open();
    expect(sdk.deviceFirst.open()).toBe(contents);
    expect(contents.containerStore).toBe(sdk.containerContents.openTree());
    expect(contents.containerStore.createChild).toBeFunction();
    expect(contents.containerStore.moveContainer).toBeFunction();
    expect(contents.containerStore.renameContainer).toBeFunction();

    const view = contents.view;
    expect(sdk.deviceFirst.open().view).toBe(view);
    expect(sdk.deviceFirst.open().reconciler).toBe(contents.reconciler);

    expect(view.getSnapshot).toBeFunction();
    expect(view.subscribe).toBeFunction();
    expect(view.setActiveContainer).toBeFunction();
    expect(view.getSnapshot().ready).toBe(false);
  });

  test("auto-provisions identity after SQLite becomes ready", async () => {
    const { close, execSql } = await createTestExecSql(
      "tearleads-constructor-auto-provision-test",
    );
    try {
      const sdk = new Tearleads({
        identityProvisioning: "auto",
        logger: quietLogger,
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sdk.identity.signingFingerprint).toBeNull();
      expect(sdk.session.containerId).toBeNull();

      sdk.database.configure({ execSql, id: "client-db" });
      await waitForProvisionedIdentity(sdk);

      expect(sdk.identity.signingFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(sdk.identity.encapsulationKeyPair).not.toBeNull();
      expect(sdk.identity.signingKeyPair).not.toBeNull();
      expect(sdk.session.containerId).toHaveLength(36);
      expect(await loadContainers(execSql)).toEqual([
        expect.objectContaining({
          id: sdk.session.containerId,
          name: "/",
          parentId: null,
        }),
      ]);
    } finally {
      close();
    }
  });
});
