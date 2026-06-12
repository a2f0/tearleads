import { type FormEvent, type PropsWithChildren, useState } from "react";
import {
  MiniAppButton,
  MiniAppField,
  MiniAppFormPanel,
  MiniAppInput,
  MiniAppPanel,
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

  if (!lock.isLocked) {
    return children;
  }

  return (
    <MiniAppRoot centered className="local-keyring-unlock-gate">
      <LocalKeyringUnlockPanel appName={appName} />
    </MiniAppRoot>
  );
}

export function LocalKeyringUnlockWindow() {
  const lock = useLocalKeyringLock();

  return (
    <MiniAppRoot centered className="local-keyring-unlock-gate">
      {lock.isLocked ? (
        <LocalKeyringUnlockPanel appName="Database" />
      ) : (
        <MiniAppPanel className="local-keyring-unlock-gate-panel">
          <div className="local-keyring-unlock-copy">
            <h2>Local database unlocked</h2>
            <p>Your local keys are available in this pane.</p>
          </div>
        </MiniAppPanel>
      )}
    </MiniAppRoot>
  );
}

function LocalKeyringUnlockPanel({ appName }: { appName: string }) {
  const lock = useLocalKeyringLock();
  const [pinCode, setPinCode] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (unlocking) {
      return;
    }
    if (!pinCode) {
      setError("Enter your PIN code.");
      return;
    }

    setUnlocking(true);
    setError(null);
    try {
      const unlocked = await lock.unlock(pinCode);
      if (unlocked) {
        setPinCode("");
      } else {
        setError("That PIN did not unlock the local keychain.");
        setUnlocking(false);
      }
    } catch {
      setError("Could not unlock the local keychain.");
      setUnlocking(false);
    }
  };

  return (
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
          autoComplete="current-password"
          disabled={unlocking}
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
  );
}
