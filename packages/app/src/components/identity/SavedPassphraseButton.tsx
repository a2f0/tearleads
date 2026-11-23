import { useEffect, useRef, useState } from "react";
import type { PasswordKeychain } from "../../host/PasswordKeychain";
import { usePasswordKeychain } from "../../identity/identityKeychain";
import { useLog } from "../../providers/logging/LogProvider";
import { MiniAppButton, MiniAppStatus } from "../mini-app/MiniAppLayout";

type SavedPassphrasePick = "idle" | "picking" | "empty" | "failed";

interface SavedPassphraseProps {
  readonly disabled: boolean;
  readonly onPick: (passphrase: string) => void;
}

/**
 * Fills a recovery passphrase field from the platform's password keychain,
 * where Save to Password Manager left one. Renders nothing on a platform
 * without a keychain.
 */
export function SavedPassphraseButton(props: SavedPassphraseProps) {
  const keychain = usePasswordKeychain();
  return keychain ? (
    <SavedPassphrasePicker keychain={keychain} {...props} />
  ) : null;
}

/**
 * Only the latest pick, made while this is still mounted and enabled, fills the
 * field.
 */
function SavedPassphrasePicker({
  disabled,
  keychain,
  onPick,
}: SavedPassphraseProps & { readonly keychain: PasswordKeychain }) {
  const { logError } = useLog();
  const [pick, setPick] = useState<SavedPassphrasePick>("idle");
  // The pick allowed to finish. Disabling the field or unmounting drops it, so
  // a late pick never fills a field that no longer accepts one.
  const current = useRef<symbol | null>(null);
  useEffect(() => {
    if (!disabled) return;
    current.current = null;
    setPick((state) => (state === "picking" ? "idle" : state));
  }, [disabled]);
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
      // Browsers return nothing, without showing a chooser, when no passphrase
      // is saved, so an empty pick says so rather than looking broken.
      setPick(passphrase ? "idle" : "empty");
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
      {pick === "empty" && (
        <MiniAppStatus>No saved passphrase was chosen.</MiniAppStatus>
      )}
      {pick === "failed" && (
        <MiniAppStatus role="alert" tone="error">
          Could not read a saved passphrase from your password manager.
        </MiniAppStatus>
      )}
    </>
  );
}
