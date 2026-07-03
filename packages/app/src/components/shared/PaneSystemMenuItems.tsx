import {
  useBackupKeyPackageAction,
  useRestoreKeyPackageAction,
} from "../../identity/useKeyPackageActions";
import { useRegisterCurrentIdentity } from "../../identity/useRegisterCurrentIdentity";
import { useNetworkState } from "../../providers/api/useNetworkState";
import { useCryptoSession } from "../../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../../providers/db/DatabaseProvider";
import { useIdentity } from "../../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../../providers/local-keyring/LocalKeyringLockProvider";
import { MenuItem } from "./MenuItem";

export function PaneSystemMenuItems({
  onClose,
  onOpenUnlock,
  onRequestDestroyKeyPackage,
  onRequestLogout,
  showDeveloperControls,
}: {
  onClose: () => void;
  onOpenUnlock: () => void;
  onRequestDestroyKeyPackage: () => void;
  onRequestLogout: () => void;
  showDeveloperControls: boolean;
}) {
  return (
    <>
      <PaneWorkerMenuItems
        showDeveloperControls={showDeveloperControls}
        onClose={onClose}
      />
      <PaneNetworkMenuItems
        showDeveloperControls={showDeveloperControls}
        onClose={onClose}
      />
      <PaneUnlockMenuItem onClose={onClose} onOpenUnlock={onOpenUnlock} />
      <PaneKeyMenuItems
        showDeveloperControls={showDeveloperControls}
        onClose={onClose}
        onRequestDestroyKeyPackage={onRequestDestroyKeyPackage}
      />
      <PaneSessionMenuItems
        onClose={onClose}
        onRequestLogout={onRequestLogout}
      />
    </>
  );
}

function PaneNetworkMenuItems({
  onClose,
  showDeveloperControls,
}: {
  onClose: () => void;
  showDeveloperControls: boolean;
}) {
  const { mode, setNetworkMode } = useNetworkState();

  return (
    <>
      {showDeveloperControls && mode !== "online" && (
        <MenuItem
          label="Force Online"
          onClick={() => {
            setNetworkMode("online");
            onClose();
          }}
        />
      )}
      {showDeveloperControls && mode !== "offline" && (
        <MenuItem
          label="Force Offline"
          onClick={() => {
            setNetworkMode("offline");
            onClose();
          }}
        />
      )}
      {mode !== "automatic" && (
        <MenuItem
          label="Use Automatic Network"
          onClick={() => {
            setNetworkMode("automatic");
            onClose();
          }}
        />
      )}
    </>
  );
}

function PaneWorkerMenuItems({
  onClose,
  showDeveloperControls,
}: {
  onClose: () => void;
  showDeveloperControls: boolean;
}) {
  const { killWorker, spawnWorker, status } = useDatabase();
  const { signingKeyPair } = useIdentity();
  const isTerminated = status === "terminated";

  return (
    <>
      {showDeveloperControls && signingKeyPair && !isTerminated && (
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

function PaneUnlockMenuItem({
  onClose,
  onOpenUnlock,
}: {
  onClose: () => void;
  onOpenUnlock: () => void;
}) {
  const localKeyringLock = useLocalKeyringLock();

  if (!localKeyringLock.isLocked) {
    return null;
  }

  return (
    <MenuItem
      label="Unlock Database"
      onClick={() => {
        onOpenUnlock();
        onClose();
      }}
    />
  );
}

function PaneKeyMenuItems({
  onClose,
  onRequestDestroyKeyPackage,
  showDeveloperControls,
}: {
  onClose: () => void;
  onRequestDestroyKeyPackage: () => void;
  showDeveloperControls: boolean;
}) {
  const backupKeyPackage = useBackupKeyPackageAction({ onComplete: onClose });
  const {
    handleRestoreFileChange,
    handleRestoreKeyPackageClick,
    restoreFileInputRef,
  } = useRestoreKeyPackageAction({ onComplete: onClose });
  const { encapsulationKeyPair, generateKey, signingKeyPair } = useIdentity();
  const localKeyringLock = useLocalKeyringLock();

  return (
    <>
      {showDeveloperControls && (
        <input
          ref={restoreFileInputRef}
          aria-label="Restore Key Package File"
          type="file"
          accept="application/json,.json"
          hidden
          onChange={handleRestoreFileChange}
        />
      )}
      {!signingKeyPair && !localKeyringLock.isLocked && (
        <MenuItem
          label="Generate Key Pair"
          onClick={() => {
            generateKey();
            onClose();
          }}
        />
      )}
      {showDeveloperControls && signingKeyPair && encapsulationKeyPair && (
        <MenuItem label="Backup Key Package" onClick={backupKeyPackage} />
      )}
      {showDeveloperControls && (
        <MenuItem
          label="Restore Key Package"
          onClick={handleRestoreKeyPackageClick}
        />
      )}
      {showDeveloperControls && signingKeyPair && (
        <MenuItem
          label="Destroy Key Pair"
          onClick={() => {
            onRequestDestroyKeyPackage();
            onClose();
          }}
        />
      )}
    </>
  );
}

function PaneSessionMenuItems({
  onClose,
  onRequestLogout,
}: {
  onClose: () => void;
  onRequestLogout: () => void;
}) {
  const { isAuthenticated, login, userId } = useCryptoSession();
  const { encapsulationKeyPair, signingKeyPair } = useIdentity();
  const { canRegisterCurrentIdentity, registerCurrentIdentity } =
    useRegisterCurrentIdentity();

  return (
    <>
      {signingKeyPair && isAuthenticated && (
        <MenuItem
          label="Logout"
          onClick={() => {
            onRequestLogout();
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
