import { useRegisterCurrentIdentity } from "../../identity/useRegisterCurrentIdentity";
import { useCryptoSession } from "../../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../../providers/db/DatabaseProvider";
import { useIdentity } from "../../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../../providers/local-keyring/LocalKeyringLockProvider";
import { MenuItem } from "./MenuItem";
import { NetworkModeMenuItems } from "./NetworkModeMenuItems";

export function PaneSystemMenuItems({
  onClose,
  onOpenUnlock,
  onRequestDestroyKeyPackage,
  onRequestLogout,
  showDeveloperControls,
  showLogout = true,
}: {
  onClose: () => void;
  onOpenUnlock: () => void;
  onRequestDestroyKeyPackage: () => void;
  onRequestLogout: () => void;
  showDeveloperControls: boolean;
  showLogout?: boolean;
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
        showLogout={showLogout}
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
  return (
    <NetworkModeMenuItems
      showManualModeControls={showDeveloperControls}
      onClose={onClose}
    />
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
  const { generateKey, signingKeyPair } = useIdentity();
  const localKeyringLock = useLocalKeyringLock();

  return (
    <>
      {!signingKeyPair && !localKeyringLock.isLocked && (
        <MenuItem
          label="Generate Key Pair"
          onClick={() => {
            generateKey();
            onClose();
          }}
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
  showLogout,
}: {
  onClose: () => void;
  onRequestLogout: () => void;
  showLogout: boolean;
}) {
  const { isAuthenticated, login, userId } = useCryptoSession();
  const { encapsulationKeyPair, signingKeyPair } = useIdentity();
  const { canRegisterCurrentIdentity, registerCurrentIdentity } =
    useRegisterCurrentIdentity();

  return (
    <>
      {showLogout && signingKeyPair && isAuthenticated && (
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
