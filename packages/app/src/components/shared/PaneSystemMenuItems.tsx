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
}: {
  onClose: () => void;
  onOpenUnlock: () => void;
  onRequestDestroyKeyPackage: () => void;
  onRequestLogout: () => void;
}) {
  return (
    <>
      <PaneWorkerMenuItems onClose={onClose} />
      <PaneNetworkMenuItems onClose={onClose} />
      <PaneUnlockMenuItem onClose={onClose} onOpenUnlock={onOpenUnlock} />
      <PaneKeyMenuItems
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

function PaneNetworkMenuItems({ onClose }: { onClose: () => void }) {
  const { mode, setNetworkMode } = useNetworkState();

  return (
    <>
      {mode !== "online" && (
        <MenuItem
          label="Force Online"
          onClick={() => {
            setNetworkMode("online");
            onClose();
          }}
        />
      )}
      {mode !== "offline" && (
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
}: {
  onClose: () => void;
  onRequestDestroyKeyPackage: () => void;
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
