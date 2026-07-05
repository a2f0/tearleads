import { afterEach, expect, spyOn, test } from "bun:test";
import type {
  BlobBytes,
  LocalKeyPurpose,
  LocalKeyring,
  LocalKeyringScope,
  LocalKeyringSession,
  Tearleads,
} from "@tearleads/client-sdk";
import { act, cleanup, render } from "@testing-library/react";
import { AppHostConfig } from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../host/AppHostConfigProvider";
import { LocalKeyringLockProvider } from "../local-keyring/LocalKeyringLockProvider";
import { LogProvider } from "../logging/LogProvider";
import { SyncModeProvider } from "../sync-mode/SyncModeProvider";
import { TearleadsProvider, useTearleads } from "./TearleadsProvider";

afterEach(() => {
  cleanup();
});

const TEXT_ENCODER = new TextEncoder();

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
  hostConfig,
  onReady,
  wsUrl,
}: {
  hostConfig?: AppHostConfig | undefined;
  onReady: (tearleads: Tearleads) => void;
  wsUrl: string;
}) {
  return (
    <AppHostConfigProvider
      value={hostConfig ?? new AppHostConfig("http://api.example.test", wsUrl)}
    >
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

function blobBytes(value: string): BlobBytes {
  return TEXT_ENCODER.encode(value);
}

function localKeyForPurpose(purpose: LocalKeyPurpose): BlobBytes {
  const purposeBytes = TEXT_ENCODER.encode(purpose);
  if (purposeBytes.byteLength === 0) {
    throw new Error("Expected non-empty local key purpose.");
  }

  const key = new Uint8Array(32);
  for (let index = 0; index < key.byteLength; index += 1) {
    const purposeByte = purposeBytes[index % purposeBytes.byteLength] ?? 0;
    key[index] = purposeByte ^ index;
  }
  return key;
}

function createSerialTestLocalKeyring(observedEvents: string[]): LocalKeyring {
  let activeSession = false;

  return {
    async deleteSession() {
      activeSession = false;
    },
    async getOrCreateSession(scope) {
      if (activeSession) {
        throw new Error("Concurrent local keyring session");
      }

      activeSession = true;
      observedEvents.push(`scope:${scope.namespace}`);
      return createTestLocalKeyringSession(scope, observedEvents, () => {
        activeSession = false;
      });
    },
    async loadSession() {
      return null;
    },
  };
}

function createTestLocalKeyringSession(
  scope: LocalKeyringScope,
  observedEvents: string[],
  onDispose: () => void,
): LocalKeyringSession {
  let disposed = false;
  const normalizedScope = {
    accountId: scope.accountId ?? null,
    namespace: scope.namespace,
    signingFingerprint: scope.signingFingerprint ?? null,
  };

  return {
    blobStoreKey: localKeyForPurpose("blob-store"),
    identityPersistenceKey: localKeyForPurpose("identity-persistence"),
    manifest: { scope: normalizedScope } as LocalKeyringSession["manifest"],
    scope: normalizedScope,
    sqliteKey: "sqlite-key",
    async deriveKey(purpose) {
      if (disposed) {
        throw new Error("Local keyring session has been disposed.");
      }

      observedEvents.push(`purpose:${purpose}`);
      await Promise.resolve();
      return localKeyForPurpose(purpose);
    },
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      observedEvents.push("dispose");
      onDispose();
    },
  };
}

test("marks SDK events disconnected when the WebSocket binding changes URL", async () => {
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
    if (!tearleads) {
      throw new Error("Expected the Tearleads SDK to initialize.");
    }

    // The socket only connects once authenticated, and the handshake fetches a
    // single-use ticket first — stub both so the binding builds a socket.
    spyOn(tearleads, "requestWebSocketTicket").mockResolvedValue("test-ticket");
    await act(async () => {
      tearleads.session.setAuthToken("test-token");
      await Promise.resolve();
    });

    const firstSocket = TestWebSocket.instances[0];
    if (!firstSocket) {
      throw new Error("Expected the WebSocket to initialize.");
    }

    act(() => {
      firstSocket.dispatchEvent(new Event("open"));
    });
    expect(tearleads.events.connected).toBe(true);

    await act(async () => {
      view.rerender(
        <Harness
          wsUrl="ws://events.example.test/two"
          onReady={(nextTearleads) => {
            state.tearleads = nextTearleads;
          }}
        />,
      );
      await Promise.resolve();
    });

    expect(firstSocket.closeCalls).toBe(1);
    expect(tearleads.events.connected).toBe(false);
    expect(TestWebSocket.instances).toHaveLength(2);

    view.unmount();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("derives local keyring blob store keys by namespace without overlapping sessions", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const state: { tearleads?: Tearleads } = {};
  const observedEvents: string[] = [];
  TestWebSocket.instances = [];

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const view = render(
      <Harness
        hostConfig={
          new AppHostConfig(
            "http://api.example.test",
            "ws://events.example.test/local-keyring",
            undefined,
            undefined,
            "test-app",
            () => createSerialTestLocalKeyring(observedEvents),
          )
        }
        wsUrl="ws://events.example.test/local-keyring"
        onReady={(nextTearleads) => {
          state.tearleads = nextTearleads;
        }}
      />,
    );

    const tearleads = state.tearleads;
    if (!tearleads) {
      throw new Error("Expected the Tearleads SDK to initialize.");
    }

    tearleads.blobs.useIdentityNamespace("identity-a");
    const identityAStore = tearleads.blobs.store;
    tearleads.blobs.useIdentityNamespace("identity-b");
    const identityBStore = tearleads.blobs.store;

    await Promise.all([
      identityAStore.writeBytes("attachment-1", blobBytes("identity a")),
      identityBStore.writeBytes("attachment-1", blobBytes("identity b")),
    ]);

    await expect(identityAStore.readBytes("attachment-1")).resolves.toEqual(
      blobBytes("identity a"),
    );
    await expect(identityBStore.readBytes("attachment-1")).resolves.toEqual(
      blobBytes("identity b"),
    );
    expect(observedEvents).toEqual([
      "scope:tearleads.blob-store",
      "purpose:blob-store:identity-a",
      "dispose",
      "scope:tearleads.blob-store",
      "purpose:blob-store:identity-b",
      "dispose",
    ]);

    view.unmount();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});
