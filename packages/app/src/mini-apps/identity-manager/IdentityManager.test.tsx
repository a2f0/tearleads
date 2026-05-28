import { afterEach, expect, test } from "bun:test";
import type { Tearleads, UserSession } from "@tearleads/client-sdk";
import { createModuleSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import { act, cleanup, render, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren } from "react";
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

function TearleadsProbe({
  onReady,
}: {
  onReady: (tearleads: Tearleads) => void;
}) {
  const tearleads = useTearleads();

  onReady(tearleads);
  return null;
}

function IdentityManagerTestRuntime({
  children,
  onTearleadsReady,
}: PropsWithChildren<{ onTearleadsReady: (tearleads: Tearleads) => void }>) {
  return (
    <AppRuntimeProvider
      hostConfig={
        new AppHostConfig(
          "http://api.example.test",
          "ws://events.example.test",
          () =>
            createModuleSQLiteRuntime({
              workerConstructor: MockWorker,
            }),
        )
      }
    >
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

    if (!tearleadsRef.current) {
      throw new Error("Expected Tearleads SDK to be available after render.");
    }

    const tearleads = tearleadsRef.current;
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
