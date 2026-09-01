import { afterEach, expect, spyOn, test } from "bun:test";
import type {
  BlobBytes,
  LocalKeyPurpose,
  LocalKeyring,
  LocalKeyringScope,
  LocalKeyringSession,
  NetworkListener,
  NetworkStatusSource,
  Tearleads,
} from "@tearleads/client-sdk";
import { act, cleanup, render } from "@testing-library/react";
import {
  type AppHostConfig,
  createAppHostConfig,
} from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../host/AppHostConfigProvider";
import { LocalKeyringLockProvider } from "../local-keyring/LocalKeyringLockProvider";
import { LogProvider } from "../logging/LogProvider";
import { SyncModeProvider } from "../sync-mode/SyncModeProvider";
import { SYNC_MODE_STORAGE_KEY } from "../sync-mode/syncModePreference";
import { TearleadsProvider, useTearleads } from "./TearleadsProvider";
import {
  readyEmptyContainerTree,
  ServerEventsTestWebSocket as TestWebSocket,
} from "./test/serverEventsTestWebSocket";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

const TEXT_ENCODER = new TextEncoder();

function copyBytes(bytes: Uint8Array): BlobBytes {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

class FakeFileHandle {
  constructor(
    private readonly directory: FakeDirectoryHandle,
    private readonly name: string,
  ) {}

  async getFile(): Promise<File> {
    const bytes = this.directory.files.get(this.name);
    if (!bytes) {
      throw new DOMException("File not found", "NotFoundError");
    }

    return new Blob([bytes]) as File;
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    const directory = this.directory;
    const name = this.name;
    let pending = new Uint8Array();

    return {
      async write(chunk: FileSystemWriteChunkType) {
        if (!(chunk instanceof Uint8Array)) {
          throw new Error("Unsupported fake OPFS write chunk.");
        }

        const next = new Uint8Array(pending.byteLength + chunk.byteLength);
        next.set(pending);
        next.set(chunk, pending.byteLength);
        pending = next;
      },
      async close() {
        directory.files.set(name, copyBytes(pending));
      },
      async abort() {
        pending = new Uint8Array();
      },
    } as FileSystemWritableFileStream;
  }
}

class FakeDirectoryHandle {
  readonly directories = new Map<string, FakeDirectoryHandle>();
  readonly files = new Map<string, BlobBytes>();

  async getDirectoryHandle(
    name: string,
    options?: FileSystemGetDirectoryOptions,
  ): Promise<FileSystemDirectoryHandle> {
    const existing = this.directories.get(name);
    if (existing) {
      return existing as unknown as FileSystemDirectoryHandle;
    }
    if (!options?.create) {
      throw new DOMException("Directory not found", "NotFoundError");
    }

    const directory = new FakeDirectoryHandle();
    this.directories.set(name, directory);
    return directory as unknown as FileSystemDirectoryHandle;
  }

  async getFileHandle(
    name: string,
    options?: FileSystemGetFileOptions,
  ): Promise<FileSystemFileHandle> {
    if (!this.files.has(name) && !options?.create) {
      throw new DOMException("File not found", "NotFoundError");
    }

    return new FakeFileHandle(this, name) as unknown as FileSystemFileHandle;
  }
}

function installFakeOpfs(): () => void {
  const rootDirectory = new FakeDirectoryHandle();
  const previousStorage = Object.getOwnPropertyDescriptor(
    globalThis.navigator,
    "storage",
  );
  Object.defineProperty(globalThis.navigator, "storage", {
    configurable: true,
    value: {
      getDirectory: async () =>
        rootDirectory as unknown as FileSystemDirectoryHandle,
    },
  });

  return () => {
    if (previousStorage) {
      Object.defineProperty(globalThis.navigator, "storage", previousStorage);
    } else {
      Reflect.deleteProperty(globalThis.navigator, "storage");
    }
  };
}

function TearleadsProbe({
  onReady,
}: {
  onReady: (tearleads: Tearleads) => void;
}) {
  onReady(useTearleads());
  return null;
}

const testHostConfig = (wsUrl: string): AppHostConfig =>
  createAppHostConfig({ apiBaseUrl: "http://api.example.test", wsUrl });

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
    <AppHostConfigProvider value={hostConfig ?? testHostConfig(wsUrl)}>
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
    close() {
      activeSession = false;
    },
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

test("applies a persisted local-only preference before the first runtime input", () => {
  globalThis.localStorage.setItem(SYNC_MODE_STORAGE_KEY, "local-only");
  const state: { tearleads?: Tearleads } = {};
  const view = render(
    <Harness
      wsUrl="ws://events.example.test/local-only"
      onReady={(nextTearleads) => {
        state.tearleads = nextTearleads;
      }}
    />,
  );

  const tearleads = state.tearleads;
  if (!tearleads) {
    throw new Error("Expected the Tearleads SDK to initialize.");
  }
  // Set at construction, so there is no first-render window where the SDK still
  // reports online (which would let the reconciler/upload paths run).
  expect(tearleads.session.syncEnabled).toBe(false);
  expect(tearleads.runtime.input().state.online).toBe(false);

  view.unmount();
});

test("seeds and tracks SDK connectivity from an injected network status source", () => {
  const listeners = new Set<NetworkListener>();
  // The source reports offline while happy-dom's navigator.onLine is true: this
  // is the Capacitor Android case, where the native source must win over the
  // WebView's navigator.onLine seed.
  let sourceOnline = false;
  let disposed = false;
  const source: NetworkStatusSource = {
    getOnline: () => sourceOnline,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
    },
  };

  const state: { tearleads?: Tearleads } = {};
  const view = render(
    <Harness
      hostConfig={{
        ...testHostConfig("ws://events.example.test/network"),
        createNetworkStatus: () => source,
      }}
      wsUrl="ws://events.example.test/network"
      onReady={(nextTearleads) => {
        state.tearleads = nextTearleads;
      }}
    />,
  );

  const tearleads = state.tearleads;
  if (!tearleads) {
    throw new Error("Expected the Tearleads SDK to initialize.");
  }

  // Seeded from the source, overriding the constructor's navigator.onLine read.
  expect(tearleads.network.online).toBe(false);

  // A later native connectivity change propagates to the SDK.
  act(() => {
    sourceOnline = true;
    for (const listener of listeners) {
      listener(true);
    }
  });
  expect(tearleads.network.online).toBe(true);

  view.unmount();
  expect(disposed).toBe(true);
  expect(listeners.size).toBe(0);
});

test("falls back to window online/offline events when no source is injected", () => {
  const state: { tearleads?: Tearleads } = {};
  const view = render(
    <Harness
      wsUrl="ws://events.example.test/browser-network"
      onReady={(nextTearleads) => {
        state.tearleads = nextTearleads;
      }}
    />,
  );

  const tearleads = state.tearleads;
  if (!tearleads) {
    throw new Error("Expected the Tearleads SDK to initialize.");
  }

  // happy-dom seeds navigator.onLine as true.
  expect(tearleads.network.online).toBe(true);

  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
  expect(tearleads.network.online).toBe(false);

  act(() => {
    window.dispatchEvent(new Event("online"));
  });
  expect(tearleads.network.online).toBe(true);

  view.unmount();
});

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

    spyOn(tearleads, "requestWebSocketTicket").mockResolvedValue("test-ticket");
    await act(async () => {
      tearleads.session.setAuthToken("test-token");
      await Promise.resolve();
    });

    const firstSocket = TestWebSocket.instances[0];
    if (!firstSocket) {
      throw new Error("Expected the WebSocket to initialize.");
    }

    act(() => firstSocket.dispatchEvent(new Event("open")));
    expect(tearleads.events.connected).toBe(false);
    expect(tearleads.events.connectionGeneration).toBe(0);

    const deviceFirst = tearleads.deviceFirst.open();
    spyOn(tearleads.deviceFirst, "open").mockReturnValue({
      ...deviceFirst,
      containerStore: readyEmptyContainerTree as never,
    });
    act(() => firstSocket.dispatchInterestState([]));
    expect(tearleads.events.connected).toBe(false);
    expect(tearleads.events.connectionGeneration).toBe(0);

    act(() => {
      firstSocket.acknowledgeLastContainerInterest();
    });
    expect(tearleads.events.connected).toBe(true);
    expect(tearleads.events.connectionGeneration).toBe(1);

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
    expect(tearleads.events.connectionGeneration).toBe(1);
    expect(TestWebSocket.instances).toHaveLength(2);

    view.unmount();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("derives local keyring blob store keys by namespace without overlapping sessions", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const restoreOpfs = installFakeOpfs();
  const state: { tearleads?: Tearleads } = {};
  const observedEvents: string[] = [];
  TestWebSocket.instances = [];

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const view = render(
      <Harness
        hostConfig={{
          ...testHostConfig("ws://events.example.test/local-keyring"),
          createLocalKeyring: () =>
            createSerialTestLocalKeyring(observedEvents),
          localIdentityNamespace: "test-app",
        }}
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
    restoreOpfs();
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});
