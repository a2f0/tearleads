import { afterEach, expect, spyOn, test } from "bun:test";
import type { SymCrypt } from "@symcrypt/client-sdk";
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
import {
  readyEmptyContainerTree,
  ServerEventsTestWebSocket as TestWebSocket,
} from "./test/serverEventsTestWebSocket";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

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

test("replaces the socket on native refresh and reconciles the acknowledged gap", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const state: { symcrypt?: SymCrypt } = {};
  let refreshConnection: (() => void) | null = null;
  let reconcileCalls = 0;
  TestWebSocket.instances = [];

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const hostConfig = createAppHostConfig({
      apiBaseUrl: "http://api.example.test",
      subscribeConnectionRefresh: (listener) => {
        refreshConnection = listener;
        return () => {
          refreshConnection = null;
        };
      },
      wsUrl: "ws://events.example.test/refresh",
    });
    const view = render(
      <Harness
        hostConfig={hostConfig}
        onReady={(symcrypt) => {
          state.symcrypt = symcrypt;
        }}
      />,
    );

    const symcrypt = state.symcrypt;
    if (!symcrypt) {
      throw new Error("Expected the SymCrypt SDK to initialize.");
    }
    spyOn(symcrypt, "requestWebSocketTicket").mockResolvedValue("test-ticket");
    spyOn(symcrypt.containerContents, "openTree").mockReturnValue(
      readyEmptyContainerTree as never,
    );
    const deviceFirst = symcrypt.deviceFirst.open();
    spyOn(symcrypt.deviceFirst, "open").mockReturnValue({
      ...deviceFirst,
      containerStore: readyEmptyContainerTree,
      reconciler: {
        reconcileNow: async () => {
          reconcileCalls += 1;
        },
      },
    } as never);

    await act(async () => {
      symcrypt.session.setAuthToken("test-token");
      await Promise.resolve();
    });
    const firstSocket = TestWebSocket.instances[0];
    if (!firstSocket) {
      throw new Error("Expected the first WebSocket.");
    }
    act(() => {
      firstSocket.dispatchEvent(new Event("open"));
      firstSocket.dispatchInterestState([]);
      firstSocket.acknowledgeLastContainerInterest();
    });
    expect(symcrypt.events.connectionGeneration).toBe(1);
    expect(reconcileCalls).toBe(0);

    await act(async () => {
      refreshConnection?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(firstSocket.closeCalls).toBe(1);
    expect(symcrypt.events.connected).toBe(false);
    expect(TestWebSocket.instances).toHaveLength(2);

    const refreshedSocket = TestWebSocket.instances[1];
    if (!refreshedSocket) {
      throw new Error("Expected a replacement WebSocket after refresh.");
    }
    act(() => {
      refreshedSocket.dispatchEvent(new Event("open"));
      refreshedSocket.dispatchInterestState([]);
      refreshedSocket.acknowledgeLastContainerInterest();
    });
    expect(symcrypt.events.connected).toBe(true);
    expect(symcrypt.events.connectionGeneration).toBe(2);
    expect(reconcileCalls).toBe(1);

    view.unmount();
    expect(refreshConnection).toBeNull();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});
