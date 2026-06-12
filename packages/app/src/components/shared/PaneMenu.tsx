import { type FormEvent, useState } from "react";
import {
  useBackupKeyPackageAction,
  useRestoreKeyPackageAction,
} from "../../identity/useKeyPackageActions";
import { useRegisterCurrentIdentity } from "../../identity/useRegisterCurrentIdentity";
import { useCryptoSession } from "../../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../../providers/db/DatabaseProvider";
import { useIdentity } from "../../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../../providers/local-keyring/LocalKeyringLockProvider";
import { Menu, type MenuPosition } from "./Menu";
import { MenuItem } from "./MenuItem";
import "./PaneMenu.css";

export function PaneMenu({
  position,
  onClose,
}: {
  position: MenuPosition;
  onClose: () => void;
}) {
  return (
    <Menu position={position} onClose={onClose}>
      <PaneWorkerMenuItems onClose={onClose} />
      <PaneUnlockMenuItem onClose={onClose} />
      <PaneKeyMenuItems onClose={onClose} />
      <PaneSessionMenuItems onClose={onClose} />
    </Menu>
  );
}

function PaneWorkerMenuItems({ onClose }: { onClose: () => void }) {
  const { killWorker, spawnWorker, status } = useDatabase();
  const { signingKeyPair } = useIdentity();
  const isTerminated = status === "terminated";

  return (
    <>
      {signingKeyPair && !isTerminated && (
        <MenuItem
          label="Kill Worker"
          onClick={() => {
            killWorker();
            onClose();
          }}
        />
      )}
      {signingKeyPair && isTerminated && (
        <MenuItem
          label="Spawn Worker"
          onClick={() => {
            spawnWorker();
            onClose();
          }}
        />
      )}
    </>
  );
}

function PaneUnlockMenuItem({ onClose }: { onClose: () => void }) {
  const localKeyringLock = useLocalKeyringLock();
  const [pinCode, setPinCode] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!localKeyringLock.isLocked) {
    return null;
  }

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
      const unlocked = await localKeyringLock.unlock(pinCode);
      if (!unlocked) {
        setError("That PIN did not unlock the local database.");
        setUnlocking(false);
        return;
      }

      setPinCode("");
      onClose();
    } catch {
      setError("Could not unlock the local database.");
      setUnlocking(false);
    }
  };

  return (
    <form className="pane-menu-unlock-form" onSubmit={unlock}>
      <label>
        <span>PIN code</span>
        <input
          autoComplete="current-password"
          disabled={unlocking}
          inputMode="numeric"
          type="password"
          value={pinCode}
          onChange={(event) => setPinCode(event.currentTarget.value)}
        />
      </label>
      {error && (
        <div className="pane-menu-unlock-error" role="alert">
          {error}
        </div>
      )}
      <button disabled={unlocking} type="submit">
        {unlocking ? "Unlocking..." : "Unlock Database"}
      </button>
    </form>
  );
}

function PaneKeyMenuItems({ onClose }: { onClose: () => void }) {
  const backupKeyPackage = useBackupKeyPackageAction({ onComplete: onClose });
  const {
    handleRestoreFileChange,
    handleRestoreKeyPackageClick,
    restoreFileInputRef,
  } = useRestoreKeyPackageAction({ onComplete: onClose });
  const { destroyKey, encapsulationKeyPair, generateKey, signingKeyPair } =
    useIdentity();
  const localKeyringLock = useLocalKeyringLock();

  return (
    <>
      <input
        ref={restoreFileInputRef}
        aria-label="Restore Key Package File"
        type="file"
        accept="application/json,.json"
        hidden
        onChange={handleRestoreFileChange}
      />
      {!signingKeyPair && !localKeyringLock.isLocked && (
        <MenuItem
          label="Generate Key Pair"
          onClick={() => {
            generateKey();
            onClose();
          }}
        />
      )}
      {signingKeyPair && encapsulationKeyPair && (
        <MenuItem label="Backup Key Package" onClick={backupKeyPackage} />
      )}
      <MenuItem
        label="Restore Key Package"
        onClick={handleRestoreKeyPackageClick}
      />
      {signingKeyPair && (
        <MenuItem
          label="Destroy Key Pair"
          onClick={() => {
            destroyKey();
            onClose();
          }}
        />
      )}
    </>
  );
}

function PaneSessionMenuItems({ onClose }: { onClose: () => void }) {
  const { isAuthenticated, login, logout, userId } = useCryptoSession();
  const { encapsulationKeyPair, signingKeyPair } = useIdentity();
  const { canRegisterCurrentIdentity, registerCurrentIdentity } =
    useRegisterCurrentIdentity();

  return (
    <>
      {signingKeyPair && isAuthenticated && (
        <MenuItem
          label="Logout"
          onClick={() => {
            logout();
            onClose();
          }}
        />
      )}
      {signingKeyPair &&
        encapsulationKeyPair &&
        !userId &&
        canRegisterCurrentIdentity && (
          <MenuItem
            label="Register"
            onClick={async () => {
              onClose();
              if (!canRegisterCurrentIdentity) {
                return;
              }

              await registerCurrentIdentity();
            }}
          />
        )}
      {signingKeyPair && !isAuthenticated && (
        <MenuItem
          label="Login"
          onClick={async () => {
            onClose();
            await login();
          }}
        />
      )}
    </>
  );
}
