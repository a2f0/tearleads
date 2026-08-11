import { type FormEvent, useState } from "react";
import {
  MiniAppButton,
  MiniAppField,
  MiniAppInput,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../../../providers/local-keyring/LocalKeyringLockProvider";
import { pinCodePolicyError } from "../../../providers/local-keyring/pinCodePolicy";

type PinAction = "clear" | "set" | "unlock" | null;
type LocalKeyringLock = ReturnType<typeof useLocalKeyringLock>;

function pinStatusLabel(input: {
  readonly canManagePinCode: boolean;
  readonly isLocked: boolean;
  readonly pinCodeEnabled: boolean;
}): string {
  if (!input.canManagePinCode) {
    return "Unavailable";
  }
  if (input.isLocked) {
    return "Locked";
  }
  return input.pinCodeEnabled ? "On" : "Off";
}

const PIN_ACTION_ERROR_MESSAGE = "Could not complete the PIN action.";

function PinUnlockForm({ lock }: { readonly lock: LocalKeyringLock }) {
  const [unlockPinCode, setUnlockPinCode] = useState("");
  const [busy, setBusy] = useState<PinAction>(null);
  const [error, setError] = useState<string | null>(null);

  const unlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!unlockPinCode) {
      setError("Enter your PIN code.");
      return;
    }

    setBusy("unlock");
    setError(null);
    try {
      const unlocked = await lock.unlock(unlockPinCode);
      if (!unlocked) {
        setError("That PIN did not unlock the local keychain.");
        return;
      }
      setUnlockPinCode("");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : PIN_ACTION_ERROR_MESSAGE,
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <form className="identity-manager-pin-form" onSubmit={unlock}>
      {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
      <MiniAppField>
        <span>PIN code</span>
        <MiniAppInput
          autoComplete="current-password"
          inputMode="numeric"
          type="password"
          value={unlockPinCode}
          onChange={(event) => setUnlockPinCode(event.currentTarget.value)}
        />
      </MiniAppField>
      <MiniAppToolbar>
        <MiniAppButton disabled={busy !== null} type="submit">
          {busy === "unlock" ? "Unlocking..." : "Unlock"}
        </MiniAppButton>
      </MiniAppToolbar>
    </form>
  );
}

function PinClearForm({
  busy,
  clearPinCode,
  clearPin,
  setClearPinCode,
}: {
  readonly busy: PinAction;
  readonly clearPinCode: string;
  readonly clearPin: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  readonly setClearPinCode: (pinCode: string) => void;
}) {
  return (
    <form className="identity-manager-pin-form" onSubmit={clearPin}>
      <MiniAppField>
        <span>Current PIN</span>
        <MiniAppInput
          autoComplete="current-password"
          inputMode="numeric"
          type="password"
          value={clearPinCode}
          onChange={(event) => setClearPinCode(event.currentTarget.value)}
        />
      </MiniAppField>
      <MiniAppToolbar>
        <MiniAppButton disabled={busy !== null} type="submit" variant="ghost">
          {busy === "clear" ? "Clearing..." : "Clear PIN"}
        </MiniAppButton>
      </MiniAppToolbar>
    </form>
  );
}

function PinSetForm({
  busy,
  confirmPinCode,
  pinCode,
  pinCodeEnabled,
  setConfirmPinCode,
  setOrChangePin,
  setPinCode,
}: {
  readonly busy: PinAction;
  readonly confirmPinCode: string;
  readonly pinCode: string;
  readonly pinCodeEnabled: boolean;
  readonly setConfirmPinCode: (pinCode: string) => void;
  readonly setOrChangePin: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  readonly setPinCode: (pinCode: string) => void;
}) {
  return (
    <form className="identity-manager-pin-form" onSubmit={setOrChangePin}>
      <MiniAppField>
        <span>{pinCodeEnabled ? "New PIN" : "PIN code"}</span>
        <MiniAppInput
          autoComplete="new-password"
          inputMode="numeric"
          type="password"
          value={pinCode}
          onChange={(event) => setPinCode(event.currentTarget.value)}
        />
      </MiniAppField>
      <MiniAppField>
        <span>Confirm PIN</span>
        <MiniAppInput
          autoComplete="new-password"
          inputMode="numeric"
          type="password"
          value={confirmPinCode}
          onChange={(event) => setConfirmPinCode(event.currentTarget.value)}
        />
      </MiniAppField>
      <MiniAppToolbar>
        <MiniAppButton disabled={busy !== null} type="submit">
          {busy === "set"
            ? "Saving..."
            : pinCodeEnabled
              ? "Change PIN"
              : "Set PIN"}
        </MiniAppButton>
      </MiniAppToolbar>
    </form>
  );
}

function PinManagementForms({ lock }: { readonly lock: LocalKeyringLock }) {
  const [pinCode, setPinCode] = useState("");
  const [confirmPinCode, setConfirmPinCode] = useState("");
  const [clearPinCode, setClearPinCode] = useState("");
  const [busy, setBusy] = useState<PinAction>(null);
  const [error, setError] = useState<string | null>(null);

  const setOrChangePin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pinCode || pinCode !== confirmPinCode) {
      setError("PIN codes must be non-empty and match.");
      return;
    }
    const policyError = pinCodePolicyError(pinCode);
    if (policyError) {
      setError(policyError);
      return;
    }

    setBusy("set");
    setError(null);
    try {
      const saved = await lock.setPinCode(pinCode);
      if (!saved) {
        setError("Could not save that PIN code.");
        return;
      }
      setPinCode("");
      setConfirmPinCode("");
    } catch {
      setError(PIN_ACTION_ERROR_MESSAGE);
    } finally {
      setBusy(null);
    }
  };

  const clearPin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!clearPinCode) {
      setError("Enter the current PIN code.");
      return;
    }

    setBusy("clear");
    setError(null);
    try {
      const cleared = await lock.clearPinCode(clearPinCode);
      if (!cleared) {
        setError("Could not clear PIN locking with that PIN.");
        return;
      }
      setClearPinCode("");
    } catch {
      setError(PIN_ACTION_ERROR_MESSAGE);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
      <div className="identity-manager-pin-forms">
        <PinSetForm
          busy={busy}
          confirmPinCode={confirmPinCode}
          pinCode={pinCode}
          pinCodeEnabled={lock.pinCodeEnabled}
          setConfirmPinCode={setConfirmPinCode}
          setOrChangePin={setOrChangePin}
          setPinCode={setPinCode}
        />
        {lock.pinCodeEnabled && (
          <PinClearForm
            busy={busy}
            clearPin={clearPin}
            clearPinCode={clearPinCode}
            setClearPinCode={setClearPinCode}
          />
        )}
      </div>
    </>
  );
}

export function IdentityManagerPinCodeSection() {
  const lock = useLocalKeyringLock();
  const { signingKeyPair } = useIdentity();
  const hasSigningKeyPair = signingKeyPair !== null;

  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>PIN Lock</h2>
        <MiniAppStatus as="span">{pinStatusLabel(lock)}</MiniAppStatus>
      </MiniAppSectionHeading>
      {!lock.canManagePinCode ? (
        <MiniAppStatus>
          PIN locking is unavailable here — the local keychain is managed by the
          platform shell, or browser storage is unavailable.
        </MiniAppStatus>
      ) : lock.isLocked ? (
        <PinUnlockForm lock={lock} />
      ) : !hasSigningKeyPair ? (
        <MiniAppStatus>
          Generate a key pair first to enable PIN locking.
        </MiniAppStatus>
      ) : (
        <PinManagementForms lock={lock} />
      )}
    </MiniAppSection>
  );
}
