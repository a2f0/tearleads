import { afterEach, expect, spyOn, test } from "bun:test";
import { Tearleads } from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createSqlRuntimeBase } from "../../../test/helpers/createSqlRuntime";
import { installProfileEditorRuntime } from "../../../test/helpers/org-manager/profileEditorHarness";
import * as DeviceFirstProvider from "../device-first/DeviceFirstProvider";
import type { SelfContactIdentityView } from "./currentSelfContactIdentityState";
import { getSelfContactLocalId } from "./selfContact";
import { useCurrentSelfContactIdentity } from "./useCurrentSelfContactIdentity";

afterEach(cleanup);

test("a ready self identity survives non-authority runtime notifications", async () => {
  const runtime = await createSqlRuntimeBase("current-self-identity");
  const sdk = new Tearleads({
    database: { execSql: runtime.infra.execSql, id: "current-self-identity" },
    blobStore: runtime.infra.blobStore,
    identity: { signingFingerprint: "current-self-identity" },
    identityProvisioning: "manual",
    logger: { log: () => undefined, logError: () => undefined },
    online: false,
  });
  const { view } = sdk.deviceFirst.open();
  const restoreRuntime = installProfileEditorRuntime(sdk);
  // Only the projection view is read; the provider's runtime is not.
  const contents = spyOn(
    DeviceFirstProvider,
    "useDeviceFirstContainerContents",
  ).mockReturnValue({ view } as never);
  const statuses: SelfContactIdentityView["status"][] = [];
  const hook = renderHook(() => {
    const identity = useCurrentSelfContactIdentity();
    statuses.push(identity.status);
    return identity;
  });
  try {
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    const ready = hook.result.current;
    if (ready.status !== "ready") throw new Error("Expected ready identity");
    statuses.length = 0;
    const version = sdk.runtime.version;
    act(() => {
      sdk.session.setSyncEnabled(false);
    });
    expect(sdk.runtime.version).toBeGreaterThan(version);
    expect(statuses).not.toContain("pending");
    expect(hook.result.current).toBe(ready);
    expect(ready.isCurrent()).toBe(true);
    expect(await ready.runWhenCurrent(() => "ran")).toBe("ran");

    act(() => {
      sdk.session.setUserId("00000000-0000-4000-8000-000000000098");
    });
    expect(ready.isCurrent()).toBe(false);
    // Returning to the original principal does not revive the authority.
    act(() => {
      sdk.session.setUserId(null);
    });
    expect(ready.isCurrent()).toBe(false);
    expect(await ready.runWhenCurrent(() => "ran")).toBeNull();
  } finally {
    hook.unmount();
    contents.mockRestore();
    restoreRuntime();
    sdk.dispose();
    runtime.close();
  }
});

test("a keyless ready database is absent until signing keys yield a new source", async () => {
  const runtime = await createSqlRuntimeBase("absent-self-identity");
  const sdk = new Tearleads({
    database: { execSql: runtime.infra.execSql, id: "absent-self-identity" },
    blobStore: runtime.infra.blobStore,
    identityProvisioning: "manual",
    logger: { log: () => undefined, logError: () => undefined },
    online: false,
  });
  const { view } = sdk.deviceFirst.open();
  const restoreRuntime = installProfileEditorRuntime(sdk);
  const contents = spyOn(
    DeviceFirstProvider,
    "useDeviceFirstContainerContents",
  ).mockReturnValue({ view } as never);
  const hook = renderHook(() => useCurrentSelfContactIdentity());
  try {
    expect(sdk.runtime.input(null).infra.dbStatus).toBe("ready");
    expect(sdk.identity.signingFingerprint).toBeNull();
    await waitFor(() => expect(hook.result.current.status).toBe("absent"));
    const absent = hook.result.current;
    if (absent.status !== "absent") throw new Error("Expected absent identity");
    expect(await absent.runWhenCurrent(() => "ran")).toBe("ran");

    await act(async () => {
      await sdk.identity.setKeyPairs({
        encapsulationKeyPair: null,
        signingFingerprint: "absent-self-identity",
        signingKeyPair: null,
      });
    });
    expect(absent.isCurrent()).toBe(false);
    expect(await absent.runWhenCurrent(() => "ran")).toBeNull();
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    const ready = hook.result.current;
    if (ready.status !== "ready") throw new Error("Expected ready identity");
    expect(ready.identity.localId).toBe(
      getSelfContactLocalId("absent-self-identity"),
    );
  } finally {
    hook.unmount();
    contents.mockRestore();
    restoreRuntime();
    sdk.dispose();
    runtime.close();
  }
});
