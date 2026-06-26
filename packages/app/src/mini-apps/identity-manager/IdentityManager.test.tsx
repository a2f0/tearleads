import { afterEach, expect, test } from "bun:test";
import type { Tearleads, UserSession } from "@tearleads/client-sdk";
import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { type PropsWithChildren, useEffect } from "react";
import { MockWorker } from "../../../test/helpers/mockWorker";
import { DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE } from "../../components/shared/DestroyKeyPackageConfirmationDialog";
import { AppHostConfig } from "../../host/AppHostConfig";
import { AppRuntimeProvider } from "../../providers/AppRuntimeProvider";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import { IdentityManager } from "./IdentityManager";

const ACTIVE_SESSION: UserSession = {
  createdAt: "2026-05-28T14:00:00.000Z",
  id: "a".repeat(64),
  ipAddresses: ["198.51.100.10", "203.0.113.9"],
  isCurrent: true,
  lastActiveAt: "2026-05-28T14:05:00.000Z",
  lastActiveIp: "203.0.113.9",
  signingKeyFingerprint: "b".repeat(64),
};

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  "clipboard",
);

class TestWebSocket extends EventTarget {
  constructor(readonly url: string | URL) {
    super();
  }

  close() {}
}

const TEST_HOST_CONFIG = new AppHostConfig(
  "http://api.example.test",
  "ws://events.example.test",
  () =>
    createSQLiteRuntime({
      workerConstructor: MockWorker,
    }),
);

function TearleadsProbe({
  onReady,
}: {
  onReady: (tearleads: Tearleads) => void;
}) {
  const tearleads = useTearleads();

  useEffect(() => {
    onReady(tearleads);
  }, [onReady, tearleads]);

  return null;
}

function IdentityManagerTestRuntime({
  children,
  onTearleadsReady,
}: PropsWithChildren<{ onTearleadsReady: (tearleads: Tearleads) => void }>) {
  return (
    <AppRuntimeProvider hostConfig={TEST_HOST_CONFIG}>
      <TearleadsProbe onReady={onTearleadsReady} />
      {children}
    </AppRuntimeProvider>
  );
}

afterEach(() => {
  cleanup();
  if (originalClipboardDescriptor) {
    Object.defineProperty(
      Navigator.prototype,
      "clipboard",
      originalClipboardDescriptor,
    );
  } else {
    delete (Navigator.prototype as { clipboard?: Clipboard }).clipboard;
  }
});

function installClipboardWriteMock(): string[] {
  const writes: string[] = [];
  Object.defineProperty(Navigator.prototype, "clipboard", {
    configurable: true,
    get: () => ({
      writeText: (value: string) => {
        writes.push(value);
        return Promise.resolve();
      },
    }),
  });
  return writes;
}

test("active sessions render last IP and session IP history", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const tearleadsRef: { current: Tearleads | null } = { current: null };

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const view = render(
      <IdentityManagerTestRuntime
        onTearleadsReady={(sdk) => {
          tearleadsRef.current = sdk;
        }}
      />,
    );

    await waitFor(() => {
      expect(tearleadsRef.current).toBeTruthy();
    });

    const tearleads = tearleadsRef.current;
    if (!tearleads) {
      throw new Error("Expected Tearleads SDK to be available after render.");
    }

    const originalListSessions = tearleads.session.listSessions;
    try {
      tearleads.session.listSessions = async () => [ACTIVE_SESSION];
      await act(async () => {
        await tearleads.identity.setKeyPairs({
          encapsulationKeyPair: null,
          signingFingerprint: "b".repeat(64),
          signingKeyPair: generateSigningSeedAndKeyPair(),
        });
        tearleads.session.setContext({
          authToken: "test-token",
          containerId: "container-1",
          isAuthenticated: true,
          organizationId: "org-1",
          userId: "user-1",
        });
      });

      view.rerender(
        <IdentityManagerTestRuntime
          onTearleadsReady={(sdk) => {
            tearleadsRef.current = sdk;
          }}
        >
          <IdentityManager />
        </IdentityManagerTestRuntime>,
      );

      await waitFor(() => {
        const table = view.getByRole("table");
        expect(
          within(table).getByRole("columnheader", { name: "Last IP" }),
        ).toBeTruthy();
        expect(
          within(table).getByRole("columnheader", { name: "IPs" }),
        ).toBeTruthy();
        expect(within(table).getByText("203.0.113.9")).toBeTruthy();
        expect(within(table).getByText("198.51.100.10, +1")).toBeTruthy();
      });
    } finally {
      tearleads.session.listSessions = originalListSessions;
    }
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("identity detail copies the authenticated user id", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const tearleadsRef: { current: Tearleads | null } = { current: null };
  const clipboardWrites = installClipboardWriteMock();

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const view = render(
      <IdentityManagerTestRuntime
        onTearleadsReady={(sdk) => {
          tearleadsRef.current = sdk;
        }}
      >
        <IdentityManager />
      </IdentityManagerTestRuntime>,
    );

    await waitFor(() => {
      expect(tearleadsRef.current).toBeTruthy();
    });

    const tearleads = tearleadsRef.current;
    if (!tearleads) {
      throw new Error("Expected Tearleads SDK to be available after render.");
    }

    const originalListSessions = tearleads.session.listSessions;
    try {
      tearleads.session.listSessions = async () => [];
      await act(async () => {
        tearleads.session.setContext({
          authToken: "test-token",
          containerId: "container-1",
          isAuthenticated: true,
          organizationId: "org-1",
          userId: "user-1",
        });
      });

      view.rerender(
        <IdentityManagerTestRuntime
          onTearleadsReady={(sdk) => {
            tearleadsRef.current = sdk;
          }}
        >
          <IdentityManager />
        </IdentityManagerTestRuntime>,
      );

      await waitFor(() => {
        expect(view.getByText("user-1")).toBeTruthy();
      });

      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Copy user ID" }));
      });

      expect(clipboardWrites).toEqual(["user-1"]);
    } finally {
      tearleads.session.listSessions = originalListSessions;
    }
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("identity manager confirms before destroying a key package", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const tearleadsRef: { current: Tearleads | null } = { current: null };

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const view = render(
      <IdentityManagerTestRuntime
        onTearleadsReady={(sdk) => {
          tearleadsRef.current = sdk;
        }}
      >
        <IdentityManager />
      </IdentityManagerTestRuntime>,
    );

    await waitFor(() => {
      expect(tearleadsRef.current).toBeTruthy();
    });

    const tearleads = tearleadsRef.current;
    if (!tearleads) {
      throw new Error("Expected Tearleads SDK to be available after render.");
    }

    await act(async () => {
      await tearleads.identity.setKeyPairs({
        encapsulationKeyPair: null,
        signingKeyPair: generateSigningSeedAndKeyPair(),
      });
    });

    const destroyRequestButton = await view.findByRole("button", {
      name: "Destroy Key Pair",
    });
    fireEvent.click(destroyRequestButton);

    expect(view.getByRole("dialog")).toBeTruthy();
    expect(view.getByText(/non-recoverable operation/u)).toBeTruthy();

    const destroyButton = view.getByRole("button", {
      name: "Destroy Key Package",
    }) as HTMLButtonElement;
    expect(destroyButton.disabled).toBe(true);

    fireEvent.change(view.getByLabelText(/Type confirm delete to continue/u), {
      target: { value: DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE },
    });
    expect(destroyButton.disabled).toBe(false);

    fireEvent.click(destroyButton);

    await waitFor(() => {
      expect(view.getByText("No key pair")).toBeTruthy();
      expect(
        view.queryByRole("button", { name: "Destroy Key Pair" }),
      ).toBeNull();
    });
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("PIN lock setup waits for a generated local key pair", async () => {
  const originalIndexedDB = globalThis.indexedDB;
  const hadIndexedDB = "indexedDB" in globalThis;
  const originalWebSocket = globalThis.WebSocket;
  const tearleadsRef: { current: Tearleads | null } = { current: null };

  try {
    Reflect.set(globalThis, "indexedDB", originalIndexedDB ?? {});
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const view = render(
      <IdentityManagerTestRuntime
        onTearleadsReady={(sdk) => {
          tearleadsRef.current = sdk;
        }}
      >
        <IdentityManager />
      </IdentityManagerTestRuntime>,
    );

    await waitFor(() => {
      expect(tearleadsRef.current).toBeTruthy();
      expect(
        view.getByText("Generate a key pair first to enable PIN locking."),
      ).toBeTruthy();
    });
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
    if (hadIndexedDB) {
      Reflect.set(globalThis, "indexedDB", originalIndexedDB);
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }
  }
});
