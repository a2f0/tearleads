import { afterEach, expect, spyOn, test } from "bun:test";
import type { SymCrypt, UserSession } from "@symcrypt/client-sdk";
import { generateSigningSeedAndKeyPair } from "@symcrypt/crypto";
import {
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import {
  cleanupIdentityManagerTestEnvironment,
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
  TestWebSocket,
} from "../../../test/helpers/identityManagerTestRuntime";
import "../../../test/helpers/mswServer";
import { DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE } from "../../components/shared/DestroyKeyPackageConfirmationDialog";
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

const REMOTE_SESSION: UserSession = {
  createdAt: "2026-05-27T11:00:00.000Z",
  id: "c".repeat(64),
  ipAddresses: ["192.0.2.44"],
  isCurrent: false,
  lastActiveAt: "2026-05-27T11:10:00.000Z",
  lastActiveIp: "192.0.2.44",
  signingKeyFingerprint: "d".repeat(64),
};

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  "clipboard",
);

const TEST_HOST_CONFIG = createIdentityManagerHostConfig();

afterEach(async () => {
  await cleanupIdentityManagerTestEnvironment();
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

async function renderAuthenticatedIdentityManagerWithSessions(
  sessions: ReadonlyArray<UserSession>,
  section: "Active Sessions" | "General" = "Active Sessions",
) {
  const originalWebSocket = globalThis.WebSocket;
  const symcryptRef: { current: SymCrypt | null } = { current: null };
  Reflect.set(globalThis, "WebSocket", TestWebSocket);
  const view = render(
    <IdentityManagerTestRuntime
      hostConfig={TEST_HOST_CONFIG}
      onSymCryptReady={(sdk) => {
        symcryptRef.current = sdk;
      }}
    >
      <IdentityManager />
    </IdentityManagerTestRuntime>,
  );

  await waitFor(() => {
    expect(symcryptRef.current).toBeTruthy();
  });

  const symcrypt = symcryptRef.current;
  if (!symcrypt) {
    throw new Error("Expected SymCrypt SDK to be available after render.");
  }

  const originalListSessions = symcrypt.session.listSessions;
  spyOn(symcrypt, "requestWebSocketTicket").mockResolvedValue(null);
  symcrypt.session.listSessions = async () => [...sessions];
  await act(async () => {
    await symcrypt.identity.setKeyPairs({
      encapsulationKeyPair: null,
      signingFingerprint: "b".repeat(64),
      signingKeyPair: generateSigningSeedAndKeyPair(),
    });
    symcrypt.session.setContext({
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
      onSymCryptReady={(sdk) => {
        symcryptRef.current = sdk;
      }}
    >
      <IdentityManager />
    </IdentityManagerTestRuntime>,
  );

  fireEvent.click(view.getByRole("button", { name: section }));

  await waitFor(() => {
    expect(
      section === "Active Sessions"
        ? view.getByRole("table")
        : view.getByRole("heading", { name: "Identity" }),
    ).toBeTruthy();
  });

  return {
    restore: () => {
      symcrypt.session.listSessions = originalListSessions;
      Reflect.set(globalThis, "WebSocket", originalWebSocket);
    },
    symcrypt,
    view,
  };
}

test("active sessions hide diagnostic columns by default and expose the columns menu", async () => {
  const { restore, view } =
    await renderAuthenticatedIdentityManagerWithSessions([ACTIVE_SESSION]);

  try {
    const table = view.getByRole("table");
    expect(
      within(table).getByRole("columnheader", { name: "Last IP" }),
    ).toBeTruthy();
    expect(
      within(table).queryByRole("columnheader", { name: "IPs" }),
    ).toBeNull();
    expect(
      within(table).queryByRole("columnheader", { name: "Created" }),
    ).toBeNull();
    expect(
      within(table).queryByRole("columnheader", { name: "Signing Key" }),
    ).toBeNull();
    expect(
      within(table).queryByRole("columnheader", { name: "Session ID" }),
    ).toBeNull();
    expect(within(table).getByText("203.0.113.9")).toBeTruthy();
    expect(within(table).queryByText("198.51.100.10, +1")).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Columns" }));

    const fullIpListToggle = view.getByRole("checkbox", {
      name: "Full IP List Off",
    });
    expect((fullIpListToggle as HTMLInputElement).checked).toBe(false);
    expect(
      (
        view.getByRole("checkbox", {
          name: "Created Off",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(
      (
        view.getByRole("checkbox", {
          name: "Signing Key Off",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(
      (
        view.getByRole("checkbox", {
          name: "Session ID Off",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);

    fireEvent.click(fullIpListToggle);

    expect(
      within(table).getByRole("columnheader", { name: "IPs" }),
    ).toBeTruthy();
    expect(within(table).getByText("198.51.100.10, +1")).toBeTruthy();
  } finally {
    restore();
  }
});

test("session rows open details and expose context menu actions", async () => {
  const { restore, symcrypt, view } =
    await renderAuthenticatedIdentityManagerWithSessions([
      ACTIVE_SESSION,
      REMOTE_SESSION,
    ]);
  const originalDestroySession = symcrypt.session.destroySession;
  const destroyedSessionIds: string[] = [];

  try {
    symcrypt.session.destroySession = async (sessionId) => {
      destroyedSessionIds.push(sessionId);
      return true;
    };
    const getMenuButton = (label: string) => {
      const button = view.getByText(label).closest("button");
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Expected menu button: ${label}`);
      }
      return button;
    };
    let table = view.getByRole("table");
    const getSessionRow = (text: string) => {
      const row = within(table).getByText(text).closest("tr");
      if (!(row instanceof HTMLTableRowElement)) {
        throw new Error(`Expected session row for: ${text}`);
      }
      return row;
    };

    fireEvent.click(within(table).getByText("203.0.113.9"));

    const detailTable = view.getByRole("table");
    expect(detailTable.className).toContain("mini-app-info-table--borderless");
    expect(detailTable.className).toContain("mini-app-info-table--aligned");
    expect(detailTable.className).toContain(
      "identity-manager-session-detail-table",
    );
    expect(view.getByText("Current Session")).toBeTruthy();
    const getDetailValue = (label: string) => {
      const valueButton = view.getByRole("button", {
        name: new RegExp(`Show full ${label}`),
      });
      if (!(valueButton instanceof HTMLButtonElement)) {
        throw new Error(`Expected ${label} disclosure`);
      }
      return valueButton;
    };
    const sessionIdValue = getDetailValue("Session ID");
    expect(sessionIdValue.textContent).toBe(ACTIVE_SESSION.id);
    expect(getDetailValue("Signing Key").textContent).toBe(
      ACTIVE_SESSION.signingKeyFingerprint,
    );
    expect(getDetailValue("Full IP List").textContent).toBe(
      "198.51.100.10, 203.0.113.9",
    );
    fireEvent.click(sessionIdValue);
    expect(sessionIdValue.getAttribute("aria-pressed")).toBe("true");
    expect(view.queryByText("Active Sessions")).toBeNull();
    expect(view.queryByText("Identity")).toBeNull();
    expect(view.queryByRole("button", { name: "Copy session ID" })).toBeNull();
    expect(view.queryByRole("button", { name: "Copy signing key" })).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Back" }));
    expect(view.queryByText("Current Session")).toBeNull();
    table = view.getByRole("table");

    const currentRow = getSessionRow("203.0.113.9");
    expect(
      within(currentRow).getByRole("button", {
        name: "Actions for Current session 203.0.113.9",
      }),
    ).toBeTruthy();
    expect(
      within(currentRow).queryByRole("button", { name: "Log Out" }),
    ).toBeNull();

    const remoteRow = getSessionRow("192.0.2.44");
    expect(
      within(remoteRow).queryByRole("button", { name: "Revoke" }),
    ).toBeNull();
    fireEvent.click(
      within(remoteRow).getByRole("button", {
        name: "Actions for Active session 192.0.2.44",
      }),
    );
    expect(view.queryByText("Active Session")).toBeNull();
    expect(destroyedSessionIds).toEqual([]);
    expect(view.queryByText("Active Session")).toBeNull();
    expect(remoteRow.getAttribute("aria-selected")).toBe("true");
    expect(view.baseElement.querySelectorAll(".menu-item-icon")).toHaveLength(
      2,
    );
    fireEvent.click(getMenuButton("Get Info"));

    expect(view.getByText("Active Session")).toBeTruthy();
    expect(getDetailValue("Session ID").textContent).toBe(REMOTE_SESSION.id);
    expect(view.queryByText("Active Sessions")).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Back" }));
    table = view.getByRole("table");

    fireEvent.contextMenu(getSessionRow("192.0.2.44"), {
      clientX: 12,
      clientY: 34,
    });
    fireEvent.click(getMenuButton("Log Out Session"));

    await waitFor(() => {
      expect(destroyedSessionIds).toEqual([REMOTE_SESSION.id]);
    });
  } finally {
    symcrypt.session.destroySession = originalDestroySession;
    restore();
  }
});

test("current-session logout is reachable from the identity actions menu", async () => {
  const { restore, view } =
    await renderAuthenticatedIdentityManagerWithSessions(
      [ACTIVE_SESSION],
      "General",
    );

  try {
    const identitySection = view
      .getByRole("heading", { name: "Identity" })
      .closest("section");
    if (!identitySection) {
      throw new Error("Expected the identity section.");
    }

    // The inline toolbar button is gone; logout now lives in the overflow menu.
    expect(
      within(identitySection).queryByRole("button", { name: "Log Out" }),
    ).toBeNull();

    fireEvent.click(
      within(identitySection).getByRole("button", {
        name: "Identity actions",
      }),
    );
    const menu = view.baseElement.querySelector(".menu");
    if (!(menu instanceof HTMLElement)) {
      throw new Error("Expected the identity actions menu to open.");
    }
    fireEvent.click(within(menu).getByRole("button", { name: "Log Out" }));

    const dialog = view.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "Log Out" }),
    ).toBeTruthy();
  } finally {
    restore();
  }
});

test("identity actions menu trigger toggles the menu shut when reclicked", async () => {
  const { restore, view } =
    await renderAuthenticatedIdentityManagerWithSessions(
      [ACTIVE_SESSION],
      "General",
    );

  try {
    const identitySection = view
      .getByRole("heading", { name: "Identity" })
      .closest("section");
    if (!identitySection) {
      throw new Error("Expected the identity section.");
    }
    const trigger = within(identitySection).getByRole("button", {
      name: "Identity actions",
    });

    fireEvent.click(trigger);
    expect(view.baseElement.querySelector(".menu")).not.toBeNull();

    // Re-clicking the trigger issues mousedown (which the Menu listens for to
    // close on outside clicks) then click. The menu must end up closed, not
    // close-and-reopen.
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    expect(view.baseElement.querySelector(".menu")).toBeNull();
  } finally {
    restore();
  }
});

test("identity actions menu stays hidden while signed out", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const symcryptRef: { current: SymCrypt | null } = { current: null };

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const view = render(
      <IdentityManagerTestRuntime
        hostConfig={TEST_HOST_CONFIG}
        onSymCryptReady={(sdk) => {
          symcryptRef.current = sdk;
        }}
      >
        <IdentityManager />
      </IdentityManagerTestRuntime>,
    );

    fireEvent.click(view.getByRole("button", { name: "General" }));

    await waitFor(() => {
      expect(view.getByRole("heading", { name: "Identity" })).toBeTruthy();
    });

    expect(view.queryByRole("button", { name: "Identity actions" })).toBeNull();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("identity detail copies the authenticated user id", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const symcryptRef: { current: SymCrypt | null } = { current: null };
  const clipboardWrites = installClipboardWriteMock();

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const view = render(
      <IdentityManagerTestRuntime
        hostConfig={TEST_HOST_CONFIG}
        onSymCryptReady={(sdk) => {
          symcryptRef.current = sdk;
        }}
      />,
    );

    await waitFor(() => {
      expect(symcryptRef.current).toBeTruthy();
    });

    const symcrypt = symcryptRef.current;
    if (!symcrypt) {
      throw new Error("Expected SymCrypt SDK to be available after render.");
    }

    const originalListSessions = symcrypt.session.listSessions;
    try {
      spyOn(symcrypt, "requestWebSocketTicket").mockResolvedValue(null);
      symcrypt.session.listSessions = async () => [];
      await act(async () => {
        symcrypt.session.setContext({
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
          onSymCryptReady={(sdk) => {
            symcryptRef.current = sdk;
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

      expect(clipboardWrites).toEqual(["user-1"]);
    } finally {
      symcrypt.session.listSessions = originalListSessions;
    }
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("identity manager confirms before destroying a key package", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const symcryptRef: { current: SymCrypt | null } = { current: null };

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const view = render(
      <IdentityManagerTestRuntime
        hostConfig={TEST_HOST_CONFIG}
        onSymCryptReady={(sdk) => {
          symcryptRef.current = sdk;
        }}
      >
        <IdentityManager />
      </IdentityManagerTestRuntime>,
    );

    await waitFor(() => {
      expect(symcryptRef.current).toBeTruthy();
    });

    const symcrypt = symcryptRef.current;
    if (!symcrypt) {
      throw new Error("Expected SymCrypt SDK to be available after render.");
    }

    await act(async () => {
      await symcrypt.identity.setKeyPairs({
        encapsulationKeyPair: null,
        signingKeyPair: generateSigningSeedAndKeyPair(),
      });
    });

    fireEvent.click(view.getByRole("button", { name: "General" }));

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
