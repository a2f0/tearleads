import { afterEach, expect, test } from "bun:test";
import type { NetworkStatusSource, SymCrypt } from "@symcrypt/client-sdk";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import {
  type AppHostConfig,
  createAppHostConfig,
} from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../host/AppHostConfigProvider";
import { LocalKeyringLockProvider } from "../local-keyring/LocalKeyringLockProvider";
import { LogProvider, useLog } from "../logging/LogProvider";
import { SyncModeProvider } from "../sync-mode/SyncModeProvider";
import { SymCryptProvider, useSymCrypt } from "./SymCryptProvider";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

// Reports the SDK's readiness so the harness can await a mounted provider.
function SymCryptProbe({ onReady }: { onReady: (symcrypt: SymCrypt) => void }) {
  onReady(useSymCrypt());
  return null;
}

// Mirrors the live log stream out to the test, so an entry the provider appends
// on mount (the network diagnostic) can be asserted without rendering the Logs
// UI.
function LogProbe({
  onEntries,
}: {
  onEntries: (messages: ReadonlyArray<string>) => void;
}) {
  const { entries } = useLog();
  useEffect(() => {
    onEntries(entries.map((entry) => entry.message));
  }, [entries, onEntries]);
  return null;
}

function Harness({
  hostConfig,
  onLogEntries,
}: {
  hostConfig: AppHostConfig;
  onLogEntries: (messages: ReadonlyArray<string>) => void;
}) {
  return (
    <AppHostConfigProvider value={hostConfig}>
      <LocalKeyringLockProvider>
        <LogProvider>
          <LogProbe onEntries={onLogEntries} />
          <SyncModeProvider>
            <SymCryptProvider>
              <SymCryptProbe onReady={() => {}} />
            </SymCryptProvider>
          </SyncModeProvider>
        </LogProvider>
      </LocalKeyringLockProvider>
    </AppHostConfigProvider>
  );
}

test("logs the network source diagnostic snapshot when the source provides one", async () => {
  const source: NetworkStatusSource = {
    getOnline: () => true,
    subscribe: () => () => {},
    diagnose: () =>
      Promise.resolve("platform=android nativePlugin=false connected=false"),
  };
  let messages: ReadonlyArray<string> = [];
  const view = render(
    <Harness
      hostConfig={createAppHostConfig({
        apiBaseUrl: "http://api.example.test",
        createNetworkStatus: () => source,
        wsUrl: "ws://events.example.test/diagnose",
      })}
      onLogEntries={(next) => {
        messages = next;
      }}
    />,
  );

  await waitFor(() => {
    expect(
      messages.some((message) =>
        message.includes("Network source: platform=android nativePlugin=false"),
      ),
    ).toBe(true);
  });

  view.unmount();
});

test("logs no diagnostic when the source omits diagnose (browser default)", async () => {
  const source: NetworkStatusSource = {
    getOnline: () => true,
    subscribe: () => () => {},
  };
  let messages: ReadonlyArray<string> = [];
  const view = render(
    <Harness
      hostConfig={createAppHostConfig({
        apiBaseUrl: "http://api.example.test",
        createNetworkStatus: () => source,
        wsUrl: "ws://events.example.test/no-diagnose",
      })}
      onLogEntries={(next) => {
        messages = next;
      }}
    />,
  );

  // Flush the microtask window a diagnose() would have logged in; the optional
  // chaining must short-circuit (no throw) and add no "Network source:" entry.
  await act(async () => {
    await Promise.resolve();
  });
  expect(messages.some((message) => message.includes("Network source:"))).toBe(
    false,
  );

  view.unmount();
});
