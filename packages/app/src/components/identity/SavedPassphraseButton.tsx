import { useEffect, useRef, useState } from "react";
import type { PasswordKeychain } from "../../host/PasswordKeychain";
import { usePasswordKeychain } from "../../identity/identityKeychain";
import { useLog } from "../../providers/logging/LogProvider";
import { MiniAppButton, MiniAppStatus } from "../mini-app/MiniAppLayout";

type SavedPassphrasePick = "idle" | "picking" | "failed";

interface SavedPassphraseProps {
  readonly disabled: boolean;
  readonly onPick: (passphrase: string) => void;
}

/**
 * Fills a recovery passphrase field from the platform's password keychain,
 * where Save to Password Manager or onboarding left one. Renders nothing on a
 * platform without a keychain.
 */
export function SavedPassphraseButton(props: SavedPassphraseProps) {
  const keychain = usePasswordKeychain();
  return keychain ? (
    <SavedPassphrasePicker keychain={keychain} {...props} />
  ) : null;
}

/** Only the latest pick, made while this is still mounted, fills the field. */
function SavedPassphrasePicker({
  disabled,
  keychain,
  onPick,
}: SavedPassphraseProps & { readonly keychain: PasswordKeychain }) {
  const { logError } = useLog();
  const [pick, setPick] = useState<SavedPassphrasePick>("idle");
  // The pick allowed to finish; cleared on unmount so a late one is dropped.
  const current = useRef<symbol | null>(null);
  useEffect(
    () => () => {
      current.current = null;
    },
    [],
  );
  const start = async () => {
    const request = Symbol();
    current.current = request;
    setPick("picking");
    try {
      const passphrase = await keychain.pick();
      if (current.current !== request) return;
      current.current = null;
      setPick("idle");
      if (passphrase) onPick(passphrase);
    } catch (error: unknown) {
      if (current.current !== request) return;
      current.current = null;
      logError("Failed to read a saved recovery passphrase", error);
      setPick("failed");
    }
  };

  return (
    <>
      <MiniAppButton
        disabled={disabled || pick === "picking"}
        onClick={() => void start()}
        type="button"
      >
        Use Saved Passphrase
      </MiniAppButton>
      {pick === "failed" && (
        <MiniAppStatus role="alert" tone="error">
          Could not read a saved passphrase from your password manager.
        </MiniAppStatus>
      )}
    </>
  );
}
