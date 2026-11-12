import { useCurrentWindow } from "@tearleads/windowing";
import {
  type FormEvent,
  type PropsWithChildren,
  useEffect,
  useState,
} from "react";
import { AccountBootstrapProgressContext } from "../components/identity/AccountBootstrapLoadingPanel";
import {
  MiniAppButton,
  MiniAppField,
  MiniAppFormPanel,
  MiniAppInput,
  MiniAppPanel,
  MiniAppRoot,
  MiniAppStatePanel,
  MiniAppStatus,
  MiniAppToolbar,
} from "../components/mini-app/MiniAppLayout";
import { useAccountBootstrapProgress } from "../identity/useAccountBootstrapProgress";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../providers/local-keyring/LocalKeyringLockProvider";
import "./LocalKeyringUnlockGate.css";

type MiniAppAccessGateState = "loading" | "ready" | "setup" | "unlock";

export function resolveMiniAppAccessGateState({
  accountBootstrapping = false,
  hasSigningKeyPair,
  isLocked,
  localIdentityRestoreSettled,
  requireLocalIdentity = true,
}: {
  accountBootstrapping?: boolean;
  hasSigningKeyPair: boolean;
  isLocked: boolean;
  localIdentityRestoreSettled: boolean;
  requireLocalIdentity?: boolean;
}): MiniAppAccessGateState {
  if (isLocked) {
    return "unlock";
  }

  if (!requireLocalIdentity) {
    return "ready";
  }

  // Progress replaces manual setup while keys are being prepared. Once keys
  // exist, each app owns its loading surface so stalled account provisioning
  // cannot block local content or unmount an editor during a retry.
  if (
    !localIdentityRestoreSettled ||
    (accountBootstrapping && !hasSigningKeyPair)
  ) {
    return "loading";
  }

  return hasSigningKeyPair ? "ready" : "setup";
}

export function LocalKeyringUnlockGate({
  appName,
  children,
  requireLocalIdentity = true,
}: PropsWithChildren<{
  appName: string;
  requireLocalIdentity?: boolean;
}>) {
  const lock = useLocalKeyringLock();
  const progress = useAccountBootstrapProgress();
  const { generateKey, localIdentityRestoreSettled, signingKeyPair } =
    useIdentity();
  const gateState = resolveMiniAppAccessGateState({
    accountBootstrapping: progress !== null,
    hasSigningKeyPair: signingKeyPair !== null,
    isLocked: lock.isLocked,
    localIdentityRestoreSettled,
    requireLocalIdentity,
  });

  if (gateState === "ready") {
    return (
      <AccountBootstrapProgressContext.Provider value={progress}>
        {children}
      </AccountBootstrapProgressContext.Provider>
    );
  }

  if (gateState === "loading") {
    return (
      <MiniAppRoot>
        <MiniAppStatePanel
          busy
          description={
            progress?.description ?? "Checking for a saved local key package."
          }
          title={progress?.title ?? "Loading local keys"}
        />
      </MiniAppRoot>
    );
  }

  return (
    <MiniAppRoot centered className="local-keyring-unlock-gate">
      {gateState === "unlock" ? (
        <LocalKeyringUnlockPanel appName={appName} />
      ) : (
        <LocalIdentitySetupPanel
          appName={appName}
          onGenerateKey={generateKey}
        />
      )}
    </MiniAppRoot>
  );
}

export function LocalKeyringUnlockWindow() {
  const lock = useLocalKeyringLock();
  const currentWindow = useCurrentWindow();

  useEffect(() => {
    if (!lock.isLocked) {
      currentWindow?.close();
    }
  }, [currentWindow, lock.isLocked]);

  if (!lock.isLocked && currentWindow) {
    return null;
  }

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

function LocalIdentitySetupPanel({
  appName,
  onGenerateKey,
}: {
  appName: string;
  onGenerateKey: () => Promise<boolean>;
}) {
  const [isGenerating, setIsGenerating] = useState(false);

  const generateKey = () => {
    if (isGenerating) {
      return;
    }

    setIsGenerating(true);
    void onGenerateKey()
      .then((started) => {
        if (!started) {
          setIsGenerating(false);
        }
      })
      .catch(() => {
        setIsGenerating(false);
      });
  };

  return (
    <MiniAppPanel className="local-keyring-unlock-gate-panel">
      <div className="local-keyring-unlock-copy">
        <h2>Local keys required</h2>
        <p>Generate a local key pair to open {appName}.</p>
      </div>
      <MiniAppToolbar>
        <MiniAppButton disabled={isGenerating} onClick={generateKey}>
          {isGenerating ? "Generating..." : "Generate Key Pair"}
        </MiniAppButton>
      </MiniAppToolbar>
    </MiniAppPanel>
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
