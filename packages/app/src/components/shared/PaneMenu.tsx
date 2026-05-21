import { type ChangeEvent, useCallback, useRef } from "react";
import {
  createAppKeyPackageBackup,
  createKeyPackageFileName,
  downloadKeyPackageFile,
  parseKeyPackageFileText,
  readAppKeyPackageSession,
} from "../../identity/keyPackageBackup";
import { useRegisterCurrentIdentity } from "../../identity/useRegisterCurrentIdentity";
import { useCryptoSession } from "../../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../../providers/db/DatabaseProvider";
import { useIdentity } from "../../providers/identity/IdentityProvider";
import { useLog } from "../../providers/logging/LogProvider";
import { Menu, type MenuPosition } from "./Menu";
import { MenuItem } from "./MenuItem";

function useBackupKeyPackageAction(onClose: () => void) {
  const { containerId, organizationId, userId } = useCryptoSession();
  const { exportKeyPackage } = useIdentity();
  const { log, logError } = useLog();

  return useCallback(async () => {
    try {
      const keyPackage = await createAppKeyPackageBackup({
        identity: { exportKeyPackage },
        session: { containerId, organizationId, userId },
      });
      downloadKeyPackageFile({
        fileName: createKeyPackageFileName(keyPackage),
        keyPackage,
      });
      log("Key package backup created");
    } catch (error: unknown) {
      logError("Failed to back up key package", error);
    } finally {
      onClose();
    }
  }, [
    containerId,
    exportKeyPackage,
    log,
    logError,
    onClose,
    organizationId,
    userId,
  ]);
}

function useRestoreKeyPackageAction(onClose: () => void) {
  const { login, setContainerId, setOrganizationId, setUserId } =
    useCryptoSession();
  const { restoreKeyPackage } = useIdentity();
  const { log, logError } = useLog();
  const restoreFileInputRef = useRef<HTMLInputElement>(null);

  const restoreKeyPackageFromFile = useCallback(
    async (file: File) => {
      try {
        const parsedKeyPackage = parseKeyPackageFileText(await file.text());
        await restoreKeyPackage(parsedKeyPackage);

        const session = readAppKeyPackageSession(parsedKeyPackage);
        if (session) {
          setContainerId(session.containerId);
          setOrganizationId(session.organizationId);
          setUserId(session.userId);
          await login();
        }

        log("Key package restored");
      } catch (error: unknown) {
        logError("Failed to restore key package", error);
      } finally {
        if (restoreFileInputRef.current) {
          restoreFileInputRef.current.value = "";
        }
        onClose();
      }
    },
    [
      log,
      logError,
      login,
      onClose,
      restoreKeyPackage,
      setContainerId,
      setOrganizationId,
      setUserId,
    ],
  );

  const handleRestoreKeyPackageClick = useCallback(() => {
    restoreFileInputRef.current?.click();
  }, []);

  const handleRestoreFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      if (!file) {
        return;
      }

      void restoreKeyPackageFromFile(file);
    },
    [restoreKeyPackageFromFile],
  );

  return {
    handleRestoreFileChange,
    handleRestoreKeyPackageClick,
    restoreFileInputRef,
  };
}

export function PaneMenu({
  position,
  onClose,
}: {
  position: MenuPosition;
  onClose: () => void;
}) {
  const { killWorker, spawnWorker, status } = useDatabase();
  const { userId } = useCryptoSession();
  const { destroyKey, encapsulationKeyPair, generateKey, signingKeyPair } =
    useIdentity();
  const { canRegisterCurrentIdentity, registerCurrentIdentity } =
    useRegisterCurrentIdentity();
  const isTerminated = status === "terminated";
  const backupKeyPackage = useBackupKeyPackageAction(onClose);
  const {
    handleRestoreFileChange,
    handleRestoreKeyPackageClick,
    restoreFileInputRef,
  } = useRestoreKeyPackageAction(onClose);

  return (
    <Menu position={position} onClose={onClose}>
      <input
        ref={restoreFileInputRef}
        aria-label="Restore Key Package File"
        type="file"
        accept="application/json,.json"
        hidden
        onChange={handleRestoreFileChange}
      />
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
      {!signingKeyPair && (
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
      {signingKeyPair &&
        encapsulationKeyPair &&
        !userId &&
        canRegisterCurrentIdentity && (
          <MenuItem
            label="Upload Public Key"
            onClick={async () => {
              onClose();
              if (!canRegisterCurrentIdentity) {
                return;
              }

              await registerCurrentIdentity();
            }}
          />
        )}
    </Menu>
  );
}
