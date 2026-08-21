import { afterEach, expect, test } from "bun:test";
import {
  createBrowserNetworkStatusSource,
  type NetworkStatusSource,
  type SymCrypt,
} from "@symcrypt/client-sdk";
import { act, cleanup, render } from "@testing-library/react";
import {
  type AppHostConfig,
  createAppHostConfig,
} from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../host/AppHostConfigProvider";
import { LocalKeyringLockProvider } from "../local-keyring/LocalKeyringLockProvider";
import { LogProvider } from "../logging/LogProvider";
import { SyncModeProvider } from "../sync-mode/SyncModeProvider";
import { SymCryptProvider, useSymCrypt } from "./SymCryptProvider";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

// Reports the mounted SDK instance so a test can drive its network store.
function SymCryptProbe({ onReady }: { onReady: (symcrypt: SymCrypt) => void }) {
  onReady(useSymCrypt());
  return null;
}

function Harness({
  hostConfig,
  onReady,
}: {
  hostConfig: AppHostConfig;
  onReady: (symcrypt: SymCrypt) => void;
}) {
  return (
    <AppHostConfigProvider value={hostConfig}>
      <LocalKeyringLockProvider>
        <LogProvider>
          <SyncModeProvider>
            <SymCryptProvider>
              <SymCryptProbe onReady={onReady} />
            </SymCryptProvider>
          </SyncModeProvider>
        </LogProvider>
      </LocalKeyringLockProvider>
    </AppHostConfigProvider>
  );
}

function mountWithSource(
  source: NetworkStatusSource,
  wsUrl: string,
): { symcrypt: SymCrypt; unmount: () => void } {
  const state: { symcrypt?: SymCrypt } = {};
  const view = render(
    <Harness
      hostConfig={createAppHostConfig({
        apiBaseUrl: "http://api.example.test",
        createNetworkStatus: () => source,
        wsUrl,
      })}
      onReady={(nextSymCrypt) => {
        state.symcrypt = nextSymCrypt;
      }}
    />,
  );
  const symcrypt = state.symcrypt;
  if (!symcrypt) {
    throw new Error("Expected the SymCrypt SDK to initialize.");
  }
  return { symcrypt, unmount: () => view.unmount() };
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
  const { symcrypt, unmount } = mountWithSource(
    source,
    "ws://events.example.test/authoritative",
  );

  expect(symcrypt.network.online).toBe(true);
  act(() => {
    symcrypt.network.reportReachability(false);
  });
  expect(symcrypt.network.online).toBe(true);

  unmount();
});

test("browser connectivity keeps backend recovery retries live", () => {
  const { symcrypt, unmount } = mountWithSource(
    createBrowserNetworkStatusSource(),
    "ws://events.example.test/browser-authoritative",
  );

  expect(symcrypt.network.online).toBe(true);
  act(() => {
    symcrypt.network.reportReachability(false);
  });
  expect(symcrypt.network.online).toBe(true);

  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
  expect(symcrypt.network.online).toBe(false);

  act(() => {
    symcrypt.network.reportReachability(true);
  });
  expect(symcrypt.network.online).toBe(false);

  act(() => {
    window.dispatchEvent(new Event("online"));
  });
  expect(symcrypt.network.online).toBe(true);

  unmount();
});

test("leaves a failed request able to drive offline when the source is not authoritative", () => {
  // A custom/headless source without the authoritative flag leaves the SDK
  // non-authoritative, so a failed fetch still acts as a connectivity hint.
  const source: NetworkStatusSource = {
    getOnline: () => true,
    subscribe: () => () => {},
  };
  const { symcrypt, unmount } = mountWithSource(
    source,
    "ws://events.example.test/non-authoritative",
  );

  expect(symcrypt.network.online).toBe(true);
  act(() => {
    symcrypt.network.reportReachability(false);
  });
  expect(symcrypt.network.online).toBe(false);

  unmount();
});
