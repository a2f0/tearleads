import { afterEach, expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { createIdentitySeedPhraseFromEntropy } from "@tearleads/crypto";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import {
  cleanupIdentityManagerTestEnvironment,
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
  TestWebSocket,
} from "../../../test/helpers/identityManagerTestRuntime";
import "../../../test/helpers/mswServer";
import { IdentityManager } from "./IdentityManager";
import { RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE } from "./IdentityManagerRecoveryKeySection";

const TEST_HOST_CONFIG = createIdentityManagerHostConfig();

const ACKNOWLEDGEMENT_LABEL = new RegExp(
  `Type ${RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE} to continue`,
  "u",
);

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  "clipboard",
);

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

async function renderRecoveryKeyView(entropyByte: number) {
  const tearleadsRef: { current: Tearleads | null } = { current: null };
  const view = render(
    <IdentityManagerTestRuntime
      hostConfig={TEST_HOST_CONFIG}
      onTearleadsReady={(sdk) => {
        tearleadsRef.current = sdk;
      }}
    >
      <IdentityManager />
    </IdentityManagerTestRuntime>,
  );

  fireEvent.click(view.getByRole("button", { name: "Recovery Key" }));

  await waitFor(() => {
    expect(tearleadsRef.current).toBeTruthy();
  });

  const tearleads = tearleadsRef.current;
  if (!tearleads) {
    throw new Error("Expected Tearleads SDK to be available after render.");
  }

  const seedPhrase = createIdentitySeedPhraseFromEntropy(
    new Uint8Array(32).fill(entropyByte),
  );
  await act(async () => {
    await tearleads.identity.importSeedPhrase(seedPhrase);
  });
  await view.findByRole("button", { name: "Reveal Recovery Key" });

  return { seedPhrase, tearleads, view };
}

test("identity manager exposes the recovery key for seed-backed identities", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const tearleadsRef: { current: Tearleads | null } = { current: null };

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const view = render(
      <IdentityManagerTestRuntime
        hostConfig={TEST_HOST_CONFIG}
        onTearleadsReady={(sdk) => {
          tearleadsRef.current = sdk;
        }}
      >
        <IdentityManager />
      </IdentityManagerTestRuntime>,
    );

    fireEvent.click(view.getByRole("button", { name: "Recovery Key" }));

    await waitFor(() => {
      expect(tearleadsRef.current).toBeTruthy();
    });

    const tearleads = tearleadsRef.current;
    if (!tearleads) {
      throw new Error("Expected Tearleads SDK to be available after render.");
    }

    const seedPhrase = createIdentitySeedPhraseFromEntropy(
      new Uint8Array(32).fill(0xab),
    );

    await act(async () => {
      await tearleads.identity.importSeedPhrase(seedPhrase);
    });

    expect(
      await view.findByRole("button", { name: "Reveal Recovery Key" }),
    ).toBeTruthy();
    // The passphrase stays off screen until the disclosure is acknowledged.
    expect(view.queryByDisplayValue(seedPhrase)).toBeNull();
    expect(
      await view.findByRole("button", { name: "Copy recovery key" }),
    ).toBeTruthy();
    expect(
      await view.findByRole("button", { name: "Download Recovery Key" }),
    ).toBeTruthy();
    expect(view.queryByText("Available")).toBeNull();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("copying the recovery key requires the acknowledgement phrase", async () => {
  const originalWebSocket = globalThis.WebSocket;

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const writes = installClipboardWriteMock();
    const { seedPhrase, view } = await renderRecoveryKeyView(0xab);

    fireEvent.click(view.getByRole("button", { name: "Copy recovery key" }));

    const confirmButton = view.getByRole("button", {
      name: "Copy to Clipboard",
    }) as HTMLButtonElement;
    expect(view.getByText(/derives the private encryption keys/u)).toBeTruthy();
    expect(confirmButton.disabled).toBe(true);
    expect(writes).toEqual([]);

    fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
      target: { value: "understood" },
    });
    expect(confirmButton.disabled).toBe(true);

    fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
      target: { value: RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE },
    });
    expect(confirmButton.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(confirmButton);
    });

    expect(writes).toEqual([seedPhrase]);
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.getByText("Recovery key copied to clipboard.")).toBeTruthy();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("cancelling the download acknowledgement exports nothing", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  const downloaded = { blob: null as Blob | null };

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    URL.createObjectURL = ((blob: Blob) => {
      downloaded.blob = blob;
      return "blob:tearleads-recovery-key-test";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = () => undefined;

    const { seedPhrase, view } = await renderRecoveryKeyView(0xef);

    fireEvent.click(
      view.getByRole("button", { name: "Download Recovery Key" }),
    );
    expect(
      view.getByRole("heading", { name: "Download recovery key" }),
    ).toBeTruthy();
    expect(downloaded.blob).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    expect(view.queryByRole("dialog")).toBeNull();
    expect(downloaded.blob).toBeNull();

    fireEvent.click(
      view.getByRole("button", { name: "Download Recovery Key" }),
    );
    // The cancelled attempt must not leave its typed text behind.
    expect(
      (view.getByLabelText(ACKNOWLEDGEMENT_LABEL) as HTMLInputElement).value,
    ).toBe("");

    fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
      target: { value: RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE },
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Download File" }));
    });

    const blob = downloaded.blob;
    if (!blob) {
      throw new Error("Expected recovery key backup blob.");
    }
    expect(await blob.text()).toContain(seedPhrase);
    expect(view.getByText("Recovery key downloaded.")).toBeTruthy();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
  }
});

test("revealing the recovery key requires the acknowledgement phrase", async () => {
  const originalWebSocket = globalThis.WebSocket;

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const { seedPhrase, view } = await renderRecoveryKeyView(0x11);

    fireEvent.click(view.getByRole("button", { name: "Reveal Recovery Key" }));

    const confirmButton = view.getByRole("button", {
      name: "Show Passphrase",
    }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    expect(view.queryByDisplayValue(seedPhrase)).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    expect(view.queryByDisplayValue(seedPhrase)).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Reveal Recovery Key" }));
    fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
      target: { value: RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE },
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Show Passphrase" }));
    });

    expect(view.getByDisplayValue(seedPhrase)).toBeTruthy();
    expect(view.getByText("Recovery key revealed.")).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "Hide Recovery Key" }));
    expect(view.queryByDisplayValue(seedPhrase)).toBeNull();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("switching identities revokes an existing reveal", async () => {
  const originalWebSocket = globalThis.WebSocket;

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const { seedPhrase, tearleads, view } = await renderRecoveryKeyView(0x22);

    fireEvent.click(view.getByRole("button", { name: "Reveal Recovery Key" }));
    fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
      target: { value: RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE },
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Show Passphrase" }));
    });
    expect(view.getByDisplayValue(seedPhrase)).toBeTruthy();

    const nextSeedPhrase = createIdentitySeedPhraseFromEntropy(
      new Uint8Array(32).fill(0x33),
    );
    await act(async () => {
      await tearleads.identity.importSeedPhrase(nextSeedPhrase);
    });

    // The incoming key must never render off the previous key's acknowledgement.
    expect(view.queryByDisplayValue(nextSeedPhrase)).toBeNull();
    expect(view.queryByDisplayValue(seedPhrase)).toBeNull();
    expect(
      view.getByRole("button", { name: "Reveal Recovery Key" }),
    ).toBeTruthy();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("returning to a previously revealed identity stays hidden", async () => {
  const originalWebSocket = globalThis.WebSocket;

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const { seedPhrase, tearleads, view } = await renderRecoveryKeyView(0x66);

    fireEvent.click(view.getByRole("button", { name: "Reveal Recovery Key" }));
    fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
      target: { value: RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE },
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Show Passphrase" }));
    });
    expect(view.getByDisplayValue(seedPhrase)).toBeTruthy();

    const otherSeedPhrase = createIdentitySeedPhraseFromEntropy(
      new Uint8Array(32).fill(0x77),
    );
    await act(async () => {
      await tearleads.identity.importSeedPhrase(otherSeedPhrase);
    });
    await act(async () => {
      await tearleads.identity.importSeedPhrase(seedPhrase);
    });

    // The round trip must not restore the earlier acknowledgement.
    expect(view.queryByDisplayValue(seedPhrase)).toBeNull();
    expect(
      view.getByRole("button", { name: "Reveal Recovery Key" }),
    ).toBeTruthy();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("switching identities discards a pending acknowledgement", async () => {
  const originalWebSocket = globalThis.WebSocket;

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const { tearleads, view } = await renderRecoveryKeyView(0x44);

    fireEvent.click(view.getByRole("button", { name: "Reveal Recovery Key" }));
    fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
      target: { value: RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE },
    });

    const nextSeedPhrase = createIdentitySeedPhraseFromEntropy(
      new Uint8Array(32).fill(0x55),
    );
    await act(async () => {
      await tearleads.identity.importSeedPhrase(nextSeedPhrase);
    });

    // The dialog belonged to the previous identity; it cannot be spent here.
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.queryByDisplayValue(nextSeedPhrase)).toBeNull();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("identity manager restores a recovery key from a typed passphrase", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const tearleadsRef: { current: Tearleads | null } = { current: null };

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const view = render(
      <IdentityManagerTestRuntime
        hostConfig={TEST_HOST_CONFIG}
        onTearleadsReady={(sdk) => {
          tearleadsRef.current = sdk;
        }}
      >
        <IdentityManager />
      </IdentityManagerTestRuntime>,
    );

    fireEvent.click(view.getByRole("button", { name: "Recovery Key" }));

    await waitFor(() => {
      expect(tearleadsRef.current).toBeTruthy();
    });

    const tearleads = tearleadsRef.current;
    if (!tearleads) {
      throw new Error("Expected Tearleads SDK to be available after render.");
    }

    const seedPhrase = createIdentitySeedPhraseFromEntropy(
      new Uint8Array(32).fill(0xcd),
    );
    const restoreInput = await view.findByLabelText("Restore passphrase");

    fireEvent.change(restoreInput, {
      target: {
        value: `\n${seedPhrase.toUpperCase().replaceAll(" ", "  ")}\n`,
      },
    });
    fireEvent.click(
      view.getByRole("button", { name: "Restore from Passphrase" }),
    );

    await waitFor(() => {
      expect(tearleads.identity.seedPhrase).toBe(seedPhrase);
    });
    // A restored key is a new key: it stays hidden until acknowledged.
    expect(
      await view.findByRole("button", { name: "Reveal Recovery Key" }),
    ).toBeTruthy();
    expect(view.queryByDisplayValue(seedPhrase)).toBeNull();
    expect(view.getByText("Recovery key restored.")).toBeTruthy();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});
