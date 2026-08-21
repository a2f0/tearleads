import { afterEach, expect, test } from "bun:test";
import { createIdentitySeedPhraseFromEntropy } from "@symcrypt/crypto";
import { act, fireEvent } from "@testing-library/react";
import { TestWebSocket } from "../../../test/helpers/identityManagerTestRuntime";
import {
  ACKNOWLEDGEMENT_LABEL,
  cleanupRecoveryKeyTestEnvironment,
  installClipboardWriteMock,
  installDeferredClipboardWriteMock,
  renderRecoveryKeyView,
} from "../../../test/helpers/recoveryKeyTestKit";
import "../../../test/helpers/mswServer";
import { RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE } from "./panels/IdentityManagerRecoveryKeySection";

afterEach(cleanupRecoveryKeyTestEnvironment);

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
      return "blob:symcrypt-recovery-key-test";
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
    // The status must not keep claiming a key that is back off screen.
    expect(view.queryByText("Recovery key revealed.")).toBeNull();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("switching identities revokes an existing reveal", async () => {
  const originalWebSocket = globalThis.WebSocket;

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const { seedPhrase, symcrypt, view } = await renderRecoveryKeyView(0x22);

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
      await symcrypt.identity.importSeedPhrase(nextSeedPhrase);
    });

    // The incoming key must never render off the previous key's acknowledgement.
    expect(view.queryByDisplayValue(nextSeedPhrase)).toBeNull();
    expect(view.queryByDisplayValue(seedPhrase)).toBeNull();
    expect(
      view.getByRole("button", { name: "Reveal Recovery Key" }),
    ).toBeTruthy();
    // Feedback about the outgoing key must not carry over either.
    expect(view.queryByText("Recovery key revealed.")).toBeNull();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("returning to a previously revealed identity stays hidden", async () => {
  const originalWebSocket = globalThis.WebSocket;

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const { seedPhrase, symcrypt, view } = await renderRecoveryKeyView(0x66);

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
      await symcrypt.identity.importSeedPhrase(otherSeedPhrase);
    });
    await act(async () => {
      await symcrypt.identity.importSeedPhrase(seedPhrase);
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

test("a copy landing after an identity switch reports nothing", async () => {
  const originalWebSocket = globalThis.WebSocket;

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const clipboard = installDeferredClipboardWriteMock();
    const { seedPhrase, symcrypt, view } = await renderRecoveryKeyView(0x88);

    fireEvent.click(view.getByRole("button", { name: "Copy recovery key" }));
    fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
      target: { value: RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE },
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Copy to Clipboard" }));
    });
    expect(clipboard.writes).toEqual([seedPhrase]);

    const nextSeedPhrase = createIdentitySeedPhraseFromEntropy(
      new Uint8Array(32).fill(0x99),
    );
    await act(async () => {
      await symcrypt.identity.importSeedPhrase(nextSeedPhrase);
    });
    await act(async () => {
      clipboard.settle();
    });

    // The write carried the previous identity's key, so the incoming identity
    // must not be told its own key reached the clipboard.
    expect(view.queryByText("Recovery key copied to clipboard.")).toBeNull();
    expect(clipboard.writes).toEqual([seedPhrase]);
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("an acknowledgement cannot be moved to another disclosure", async () => {
  const originalWebSocket = globalThis.WebSocket;

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const writes = installClipboardWriteMock();
    const { view } = await renderRecoveryKeyView(0xaa);

    fireEvent.click(view.getByRole("button", { name: "Copy recovery key" }));
    fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
      target: { value: RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE },
    });

    // The dialog does not trap focus, so the toolbar behind it stays reachable.
    fireEvent.click(
      view.getByRole("button", { name: "Download Recovery Key" }),
    );

    expect(
      (view.getByRole("button", { name: "Download File" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (view.getByLabelText(ACKNOWLEDGEMENT_LABEL) as HTMLInputElement).value,
    ).toBe("");
    expect(writes).toEqual([]);
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("switching identities discards a pending acknowledgement", async () => {
  const originalWebSocket = globalThis.WebSocket;

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const { symcrypt, view } = await renderRecoveryKeyView(0x44);

    fireEvent.click(view.getByRole("button", { name: "Reveal Recovery Key" }));
    fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
      target: { value: RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE },
    });

    const nextSeedPhrase = createIdentitySeedPhraseFromEntropy(
      new Uint8Array(32).fill(0x55),
    );
    await act(async () => {
      await symcrypt.identity.importSeedPhrase(nextSeedPhrase);
    });

    // The dialog belonged to the previous identity; it cannot be spent here.
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.queryByDisplayValue(nextSeedPhrase)).toBeNull();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});
