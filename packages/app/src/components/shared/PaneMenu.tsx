import {
  useBackupKeyPackageAction,
  useRestoreKeyPackageAction,
} from "../../identity/useKeyPackageActions";
import { useRegisterCurrentIdentity } from "../../identity/useRegisterCurrentIdentity";
import { LocalKeyringUnlockWindow } from "../../mini-apps/LocalKeyringUnlockGate";
import { useCryptoSession } from "../../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../../providers/db/DatabaseProvider";
import { useIdentity } from "../../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../../providers/local-keyring/LocalKeyringLockProvider";
import { useWindowActions } from "../window/WindowStateProvider";
import { Menu, type MenuPosition } from "./Menu";
import { MenuItem } from "./MenuItem";

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
      <PaneUnlockMenuItem position={position} onClose={onClose} />
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

function PaneUnlockMenuItem({
  position,
  onClose,
}: {
  position: MenuPosition;
  onClose: () => void;
}) {
  const localKeyringLock = useLocalKeyringLock();
  const { create } = useWindowActions();

  if (!localKeyringLock.isLocked) {
    return null;
  }

  return (
    <MenuItem
      label="Unlock Database"
      onClick={() => {
        create(
          "Unlock Database",
          position.x,
          position.y,
          LocalKeyringUnlockWindow,
          {
            initialShowSidebar: false,
          },
        );
        onClose();
      }}
    />
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
