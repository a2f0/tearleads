import { afterEach, expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { act, cleanup, render } from "@testing-library/react";
import { AppHostConfig } from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../host/AppHostConfigProvider";
import { LogProvider } from "../logging/LogProvider";
import { TearleadsProvider, useTearleads } from "./TearleadsProvider";

afterEach(() => {
  cleanup();
});

class TestWebSocket extends EventTarget {
  static instances: TestWebSocket[] = [];

  closeCalls = 0;
  readonly url: string;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    TestWebSocket.instances.push(this);
  }

  close() {
    this.closeCalls += 1;
  }
}

function TearleadsProbe({
  onReady,
}: {
  onReady: (tearleads: Tearleads) => void;
}) {
  onReady(useTearleads());
  return null;
}

function Harness({
  onReady,
  wsUrl,
}: {
  onReady: (tearleads: Tearleads) => void;
  wsUrl: string;
}) {
  return (
    <AppHostConfigProvider
      value={new AppHostConfig("http://api.example.test", wsUrl)}
    >
      <LogProvider>
        <TearleadsProvider>
          <TearleadsProbe onReady={onReady} />
        </TearleadsProvider>
      </LogProvider>
    </AppHostConfigProvider>
  );
}

test("marks SDK events disconnected when the WebSocket binding changes URL", () => {
  const originalWebSocket = globalThis.WebSocket;
  const state: { tearleads?: Tearleads } = {};
  TestWebSocket.instances = [];

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const view = render(
      <Harness
        wsUrl="ws://events.example.test/one"
        onReady={(nextTearleads) => {
          state.tearleads = nextTearleads;
        }}
      />,
    );

    const tearleads = state.tearleads;
    const firstSocket = TestWebSocket.instances[0];
    if (!tearleads || !firstSocket) {
      throw new Error(
        "Expected the Tearleads SDK and WebSocket to initialize.",
      );
    }

    act(() => {
      firstSocket.dispatchEvent(new Event("open"));
    });
    expect(tearleads.events.connected).toBe(true);

    view.rerender(
      <Harness
        wsUrl="ws://events.example.test/two"
        onReady={(nextTearleads) => {
          state.tearleads = nextTearleads;
        }}
      />,
    );

    expect(firstSocket.closeCalls).toBe(1);
    expect(tearleads.events.connected).toBe(false);
    expect(TestWebSocket.instances).toHaveLength(2);

    view.unmount();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});
