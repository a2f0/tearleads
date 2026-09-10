import { afterEach, expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { createDeferred } from "../../../../test/helpers/databaseRuntimeFactories";
import { installIdentityDataTestStorage } from "../../../../test/helpers/identityDataTestStorage";
import {
  cleanupIdentityManagerTestEnvironment,
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
  TestWebSocket,
} from "../../../../test/helpers/identityManagerTestRuntime";
import "../../../../test/helpers/mswServer";
import { PANE_ASYNC_TEST_TIMEOUT_MS } from "../../../../test/helpers/paneTestUtils";
import { DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE } from "../../../components/shared/DestroyKeyPackageConfirmationDialog";
import { sqliteDbNameForSigningFingerprint } from "../../../providers/db/sqliteDbName";
import { IdentityManager } from "../IdentityManager";

afterEach(cleanupIdentityManagerTestEnvironment);

async function renderDestruction(failure: "sqlite" | "blobs") {
  const originalWebSocket = globalThis.WebSocket;
  const host = createIdentityManagerHostConfig();
  const createRuntime = host.createSQLiteRuntime;
  if (!createRuntime) {
    throw new Error("Missing test runtime factory");
  }
  const gate = createDeferred();
  let deleteCalls = 0;
  let opfs: ReturnType<typeof installIdentityDataTestStorage> | null = null;
  let fingerprint = "";
  const hostConfig = host.withOverrides({
    createSQLiteRuntime: () => {
      const runtime = createRuntime();
      const deleteDatabase = runtime.client.delete;
      runtime.client.delete = async () => {
        deleteCalls += 1;
        await gate.promise;
        if (failure === "sqlite") {
          throw new Error("Planned worker delete failure");
        }
        const result = await deleteDatabase();
        opfs?.databases.delete(
          sqliteDbNameForSigningFingerprint(fingerprint).slice(1),
        );
        return result;
      };
      return runtime;
    },
  });
  const sdkRef: { current: Tearleads | null } = { current: null };
  let view: ReturnType<typeof render> | null = null;
  const dispose = () => {
    gate.resolve();
    view?.unmount();
    opfs?.restore();
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  };
  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    view = render(
      <IdentityManagerTestRuntime
        hostConfig={hostConfig}
        onTearleadsReady={(sdk) => {
          sdkRef.current = sdk;
        }}
      >
        <IdentityManager />
      </IdentityManagerTestRuntime>,
    );
    await waitFor(() => {
      expect(sdkRef.current).not.toBeNull();
    });
    const sdk = sdkRef.current;
    if (!sdk) {
      throw new Error("Missing SDK");
    }
    await act(async () => {
      await sdk.identity.setKeyPairs({
        encapsulationKeyPair: null,
        signingKeyPair: generateSigningSeedAndKeyPair(),
      });
    });
    await waitFor(() => {
      expect(sdk.database.status).toBe("ready");
    });
    fingerprint = sdk.identity.signingFingerprint ?? "";
    opfs = installIdentityDataTestStorage([fingerprint, "b".repeat(64)]);
    if (failure === "blobs") {
      opfs.failNextRemoval("blobs");
    }
    return {
      view,
      sdk,
      opfs,
      fingerprint,
      gate,
      getDeleteCalls: () => deleteCalls,
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

for (const failure of ["sqlite", "blobs"] as const) {
  test(
    `destroy dialog blocks during wipe and retries ${failure} failure for the original identity`,
    async () => {
      const fixture = await renderDestruction(failure);
      const { view, sdk, opfs, fingerprint, gate } = fixture;
      try {
        fireEvent.click(view.getByRole("button", { name: "General" }));
        fireEvent.click(
          await view.findByRole("button", { name: "Destroy Key Pair" }),
        );
        expect(
          view.getByText(
            /permanently deletes this identity's local private keys/u,
          ),
        ).toBeTruthy();
        fireEvent.change(
          view.getByLabelText(/Type confirm delete to continue/u),
          { target: { value: DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE } },
        );
        fireEvent.click(
          view.getByRole("button", { name: "Destroy Key Package" }),
        );
        expect(
          (
            view.getByRole("button", {
              name: "Deleting local data...",
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(true);
        expect(
          (view.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
            .disabled,
        ).toBe(true);
        expect(sdk.identity.signingFingerprint).toBeNull();
        expect(opfs.blobs.has(fingerprint)).toBe(true);
        expect(fixture.getDeleteCalls()).toBe(1);
        await act(async () => {
          gate.resolve();
        });
        await waitFor(() => {
          expect(view.getByRole("alert").textContent).toContain(
            "Retry to complete deletion",
          );
        });
        expect(view.getByRole("alert").textContent).toContain(
          "reloading can restore the saved identity",
        );
        expect(
          view
            .getByLabelText(/Type confirm delete to continue/u)
            .getAttribute("aria-describedby"),
        ).toContain(view.getByRole("alert").id);
        expect(opfs.blobs.has(fingerprint)).toBe(true);
        fireEvent.click(
          view.getByRole("button", { name: "Destroy Key Package" }),
        );
        await waitFor(() => {
          expect(view.queryByRole("dialog")).toBeNull();
        });
        expect(opfs.databases).toEqual(
          new Set([`app-identity-${"b".repeat(64)}.db`]),
        );
        expect(opfs.blobs).toEqual(new Set(["b".repeat(64)]));
        expect(sdk.identity.signingFingerprint).toBeNull();
        expect(sdk.database.status).toBe("idle");
        expect(view.getByText("No key pair")).toBeTruthy();
      } finally {
        fixture.dispose();
      }
    },
    PANE_ASYNC_TEST_TIMEOUT_MS,
  );
}
