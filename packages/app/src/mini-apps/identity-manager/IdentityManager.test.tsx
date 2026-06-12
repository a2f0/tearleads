import { afterEach, expect, test } from "bun:test";
import type { Tearleads, UserSession } from "@tearleads/client-sdk";
import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import { act, cleanup, render, waitFor, within } from "@testing-library/react";
import { type PropsWithChildren, useEffect } from "react";
import { MockWorker } from "../../../test/helpers/mockWorker";
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
});

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
