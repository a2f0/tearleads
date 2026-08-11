import { afterEach, expect, test } from "bun:test";
import type { NetworkStatusSource, Tearleads } from "@tearleads/client-sdk";
import { act, cleanup, render } from "@testing-library/react";
import {
  type AppHostConfig,
  createAppHostConfig,
} from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../host/AppHostConfigProvider";
import { LocalKeyringLockProvider } from "../local-keyring/LocalKeyringLockProvider";
import { LogProvider } from "../logging/LogProvider";
import { SyncModeProvider } from "../sync-mode/SyncModeProvider";
import { TearleadsProvider, useTearleads } from "./TearleadsProvider";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

// Reports the mounted SDK instance so a test can drive its network store.
function TearleadsProbe({
  onReady,
}: {
  onReady: (tearleads: Tearleads) => void;
}) {
  onReady(useTearleads());
  return null;
}

function Harness({
  hostConfig,
  onReady,
}: {
  hostConfig: AppHostConfig;
  onReady: (tearleads: Tearleads) => void;
}) {
  return (
    <AppHostConfigProvider value={hostConfig}>
      <LocalKeyringLockProvider>
        <LogProvider>
          <SyncModeProvider>
            <TearleadsProvider>
              <TearleadsProbe onReady={onReady} />
            </TearleadsProvider>
          </SyncModeProvider>
        </LogProvider>
      </LocalKeyringLockProvider>
    </AppHostConfigProvider>
  );
}

function mountWithSource(
  source: NetworkStatusSource,
  wsUrl: string,
): { tearleads: Tearleads; unmount: () => void } {
  const state: { tearleads?: Tearleads } = {};
  const view = render(
    <Harness
      hostConfig={createAppHostConfig({
        apiBaseUrl: "http://api.example.test",
        createNetworkStatus: () => source,
        wsUrl,
      })}
      onReady={(nextTearleads) => {
        state.tearleads = nextTearleads;
      }}
    />,
  );
  const tearleads = state.tearleads;
  if (!tearleads) {
    throw new Error("Expected the Tearleads SDK to initialize.");
  }
  return { tearleads, unmount: () => view.unmount() };
}

test("treats an authoritative injected source as the sole governor of connectivity", () => {
  // The Capacitor case: a native OS-backed source reporting online. Once bound,
  // a failed backend request (reportReachability(false)) must not strand the
  // device offline — the OS, not a request outcome, owns connectivity.
  const source: NetworkStatusSource = {
    authoritative: true,
    getOnline: () => true,
    subscribe: () => () => {},
  };
  const { tearleads, unmount } = mountWithSource(
    source,
    "ws://events.example.test/authoritative",
  );

  expect(tearleads.network.online).toBe(true);
  act(() => {
    tearleads.network.reportReachability(false);
  });
  expect(tearleads.network.online).toBe(true);

  unmount();
});

test("leaves a failed request able to drive offline when the source is not authoritative", () => {
  // A source without the authoritative flag (the browser fallback's shape)
  // leaves the SDK non-authoritative, so a failed fetch still drives offline.
  const source: NetworkStatusSource = {
    getOnline: () => true,
    subscribe: () => () => {},
  };
  const { tearleads, unmount } = mountWithSource(
    source,
    "ws://events.example.test/non-authoritative",
  );

  expect(tearleads.network.online).toBe(true);
  act(() => {
    tearleads.network.reportReachability(false);
  });
  expect(tearleads.network.online).toBe(false);

  unmount();
});
