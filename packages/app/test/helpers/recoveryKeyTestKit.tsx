import { expect } from "bun:test";
import type { SymCrypt } from "@symcrypt/client-sdk";
import { createIdentitySeedPhraseFromEntropy } from "@symcrypt/crypto";
import {
  act,
  fireEvent,
  type RenderResult,
  render,
  waitFor,
} from "@testing-library/react";
import { IdentityManager } from "../../src/mini-apps/identity-manager/IdentityManager";
import { RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE } from "../../src/mini-apps/identity-manager/panels/IdentityManagerRecoveryKeySection";
import {
  cleanupIdentityManagerTestEnvironment,
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
} from "./identityManagerTestRuntime";

const TEST_HOST_CONFIG = createIdentityManagerHostConfig();

/** Matches the acknowledgement input's label in every disclosure dialog. */
export const ACKNOWLEDGEMENT_LABEL = new RegExp(
  `Type ${RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE} to continue`,
  "u",
);

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  "clipboard",
);

/** Tears down the identity runtime and restores the real clipboard. */
export async function cleanupRecoveryKeyTestEnvironment() {
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
}

/** Records clipboard writes, each resolving immediately. */
export function installClipboardWriteMock(): string[] {
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

/**
 * Records clipboard writes but leaves each pending until `settle()`, so a test
 * can land a copy's completion after the identity it was started for is gone.
 */
export function installDeferredClipboardWriteMock(): {
  readonly settle: () => void;
  readonly writes: string[];
} {
  const writes: string[] = [];
  const pending: Array<() => void> = [];
  Object.defineProperty(Navigator.prototype, "clipboard", {
    configurable: true,
    get: () => ({
      writeText: (value: string) => {
        writes.push(value);
        return new Promise<void>((resolve) => {
          pending.push(resolve);
        });
      },
    }),
  });
  return {
    settle: () => {
      for (const resolve of pending.splice(0)) {
        resolve();
      }
    },
    writes,
  };
}

/**
 * Renders the Identity Manager on its Recovery Key view with a seed-backed
 * identity imported, settled on the hidden (unacknowledged) state.
 */
export async function renderRecoveryKeyView(entropyByte: number): Promise<{
  readonly seedPhrase: string;
  readonly symcrypt: SymCrypt;
  readonly view: RenderResult;
}> {
  const symcryptRef: { current: SymCrypt | null } = { current: null };
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

  fireEvent.click(view.getByRole("button", { name: "Recovery Key" }));

  await waitFor(() => {
    expect(symcryptRef.current).toBeTruthy();
  });

  const symcrypt = symcryptRef.current;
  if (!symcrypt) {
    throw new Error("Expected SymCrypt SDK to be available after render.");
  }

  const seedPhrase = createIdentitySeedPhraseFromEntropy(
    new Uint8Array(32).fill(entropyByte),
  );
  await act(async () => {
    await symcrypt.identity.importSeedPhrase(seedPhrase);
  });
  await view.findByRole("button", { name: "Reveal Recovery Key" });

  return { seedPhrase, symcrypt, view };
}
