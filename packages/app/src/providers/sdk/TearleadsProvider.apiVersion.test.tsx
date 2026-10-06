import { afterEach, expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { act, cleanup, render } from "@testing-library/react";
import type { AppDiagnostics } from "../../host/AppDiagnostics";
import { createAppHostConfig } from "../../host/AppHostConfig";
import { useApiVersion } from "../api/useApiVersion";
import { AppHostConfigProvider } from "../host/AppHostConfigProvider";
import { LocalKeyringLockProvider } from "../local-keyring/LocalKeyringLockProvider";
import { LogProvider } from "../logging/LogProvider";
import { SyncModeProvider } from "../sync-mode/SyncModeProvider";
import { TearleadsProvider, useTearleads } from "./TearleadsProvider";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

function ApiVersionProbe({
  onReady,
}: {
  onReady: (tearleads: Tearleads) => void;
}) {
  onReady(useTearleads());
  return <output>{useApiVersion() ?? "none"}</output>;
}

test("the API build the SDK hears reaches error reports and the UI", async () => {
  const reported: number[] = [];
  const diagnostics: AppDiagnostics = {
    addBreadcrumb: () => {},
    captureError: () => {},
    setApiVersion: (version) => reported.push(version),
  };
  let tearleads: Tearleads | null = null;
  const view = render(
    <AppHostConfigProvider
      value={createAppHostConfig({
        apiBaseUrl: "http://api.example.test",
        diagnostics,
        wsUrl: "ws://events.example.test/api-version",
      })}
    >
      <LocalKeyringLockProvider>
        <LogProvider>
          <SyncModeProvider>
            <TearleadsProvider>
              <ApiVersionProbe
                onReady={(instance) => {
                  tearleads = instance;
                }}
              />
            </TearleadsProvider>
          </SyncModeProvider>
        </LogProvider>
      </LocalKeyringLockProvider>
    </AppHostConfigProvider>,
  );
  const sdk = await view.findByText("none").then(() => tearleads);
  if (sdk === null) throw new Error("TearleadsProvider did not mount");

  act(() => {
    sdk.apiVersion.observe(2460);
    sdk.apiVersion.observe(2461);
  });

  expect(await view.findByText("2461")).toBeTruthy();
  expect(reported).toEqual([2460, 2461]);
});
