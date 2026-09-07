import { afterEach, expect, spyOn, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import {
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
  TestWebSocket,
} from "../../../../test/helpers/identityManagerTestRuntime";
import {
  cleanupRecoveryKeyTestEnvironment,
  installClipboardWriteMock,
} from "../../../../test/helpers/recoveryKeyTestKit";
import "../../../../test/helpers/mswServer";
import { IdentityManager } from "../IdentityManager";

const TEST_HOST_CONFIG = createIdentityManagerHostConfig();

afterEach(cleanupRecoveryKeyTestEnvironment);

test("identity detail copies the user id and signing key fingerprint", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const tearleadsRef: { current: Tearleads | null } = { current: null };
  const clipboardWrites = installClipboardWriteMock();

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const view = render(
      <IdentityManagerTestRuntime
        hostConfig={TEST_HOST_CONFIG}
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
      spyOn(tearleads, "requestWebSocketTicket").mockResolvedValue(null);
      tearleads.session.listSessions = async () => [];
      await act(async () => {
        await tearleads.identity.setKeyPairs({
          encapsulationKeyPair: null,
          signingFingerprint: "c".repeat(64),
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
          hostConfig={TEST_HOST_CONFIG}
          onTearleadsReady={(sdk) => {
            tearleadsRef.current = sdk;
          }}
        >
          <IdentityManager />
        </IdentityManagerTestRuntime>,
      );

      fireEvent.click(view.getByRole("button", { name: "General" }));

      await waitFor(() => {
        expect(view.getByText("user-1")).toBeTruthy();
      });

      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Copy user ID" }));
      });
      await act(async () => {
        fireEvent.click(
          view.getByRole("button", { name: "Copy signing key fingerprint" }),
        );
      });

      expect(clipboardWrites).toEqual(["user-1", "c".repeat(64)]);
    } finally {
      tearleads.session.listSessions = originalListSessions;
    }
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});
