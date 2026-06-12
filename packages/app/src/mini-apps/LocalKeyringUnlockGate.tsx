import { type FormEvent, type PropsWithChildren, useState } from "react";
import {
  MiniAppButton,
  MiniAppField,
  MiniAppFormPanel,
  MiniAppInput,
  MiniAppRoot,
  MiniAppStatus,
  MiniAppToolbar,
} from "../components/shared/MiniAppLayout";
import { useLocalKeyringLock } from "../providers/local-keyring/LocalKeyringLockProvider";
import "./LocalKeyringUnlockGate.css";

export function LocalKeyringUnlockGate({
  appName,
  children,
}: PropsWithChildren<{ appName: string }>) {
  const lock = useLocalKeyringLock();
  const [pinCode, setPinCode] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!lock.isLocked) {
    return children;
  }

  const unlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pinCode) {
      setError("Enter your PIN code.");
      return;
    }

    setUnlocking(true);
    setError(null);
    try {
      const unlocked = await lock.unlock(pinCode);
      if (!unlocked) {
        setError("That PIN did not unlock the local keychain.");
      }
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <MiniAppRoot centered className="local-keyring-unlock-gate">
      <MiniAppFormPanel
        className="local-keyring-unlock-gate-panel"
        onSubmit={unlock}
      >
        <div className="local-keyring-unlock-copy">
          <h2>Local keychain locked</h2>
          <p>Unlock your local keys to open {appName}.</p>
        </div>
        <MiniAppField>
          <span>PIN code</span>
          <MiniAppInput
            autoFocus
            autoComplete="current-password"
            inputMode="numeric"
            type="password"
            value={pinCode}
            onChange={(event) => setPinCode(event.currentTarget.value)}
          />
        </MiniAppField>
        {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
        <MiniAppToolbar>
          <MiniAppButton disabled={unlocking} type="submit">
            {unlocking ? "Unlocking..." : "Unlock"}
          </MiniAppButton>
        </MiniAppToolbar>
      </MiniAppFormPanel>
    </MiniAppRoot>
  );
}
