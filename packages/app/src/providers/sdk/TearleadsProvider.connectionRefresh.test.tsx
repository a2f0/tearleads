import { afterEach, expect, spyOn, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { act, cleanup, render } from "@testing-library/react";
import { AppHostConfig } from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../host/AppHostConfigProvider";
import { LocalKeyringLockProvider } from "../local-keyring/LocalKeyringLockProvider";
import { LogProvider } from "../logging/LogProvider";
import { SyncModeProvider } from "../sync-mode/SyncModeProvider";
import { TearleadsProvider, useTearleads } from "./TearleadsProvider";
import {
  readyEmptyContainerTree,
  ServerEventsTestWebSocket as TestWebSocket,
} from "./test/serverEventsTestWebSocket";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

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

test("replaces the socket on native refresh and reconciles the acknowledged gap", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const state: { tearleads?: Tearleads } = {};
  let refreshConnection: (() => void) | null = null;
  let reconcileCalls = 0;
  TestWebSocket.instances = [];

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const hostConfig = new AppHostConfig(
      "http://api.example.test",
      "ws://events.example.test/refresh",
    ).withOverrides({
      subscribeConnectionRefresh: (listener) => {
        refreshConnection = listener;
        return () => {
          refreshConnection = null;
        };
      },
    });
    const view = render(
      <Harness
        hostConfig={hostConfig}
        onReady={(tearleads) => {
          state.tearleads = tearleads;
        }}
      />,
    );

    const tearleads = state.tearleads;
    if (!tearleads) {
      throw new Error("Expected the Tearleads SDK to initialize.");
    }
    spyOn(tearleads, "requestWebSocketTicket").mockResolvedValue("test-ticket");
    spyOn(tearleads.containerContents, "openTree").mockReturnValue(
      readyEmptyContainerTree as never,
    );
    const deviceFirst = tearleads.deviceFirst.open();
    spyOn(tearleads.deviceFirst, "open").mockReturnValue({
      ...deviceFirst,
      containerStore: readyEmptyContainerTree,
      reconciler: {
        reconcileNow: async () => {
          reconcileCalls += 1;
        },
      },
    } as never);

    await act(async () => {
      tearleads.session.setAuthToken("test-token");
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
    expect(tearleads.events.connectionGeneration).toBe(1);
    expect(reconcileCalls).toBe(0);

    await act(async () => {
      refreshConnection?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(firstSocket.closeCalls).toBe(1);
    expect(tearleads.events.connected).toBe(false);
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
    expect(tearleads.events.connected).toBe(true);
    expect(tearleads.events.connectionGeneration).toBe(2);
    expect(reconcileCalls).toBe(1);

    view.unmount();
    expect(refreshConnection).toBeNull();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});
