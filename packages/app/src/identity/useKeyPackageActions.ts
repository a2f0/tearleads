import { type ChangeEvent, useCallback, useRef } from "react";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useLog } from "../providers/logging/LogProvider";
import {
  createAppKeyPackageBackup,
  createKeyPackageFileName,
  downloadKeyPackageFile,
  parseKeyPackageFileText,
  readAppKeyPackageSession,
} from "./keyPackageBackup";

interface KeyPackageActionOptions {
  readonly onComplete?: (() => void) | undefined;
}

export function useBackupKeyPackageAction({
  onComplete,
}: KeyPackageActionOptions = {}) {
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
      onComplete?.();
    }
  }, [
    containerId,
    exportKeyPackage,
    log,
    logError,
    onComplete,
    organizationId,
    userId,
  ]);
}

export function useRestoreKeyPackageAction({
  onComplete,
}: KeyPackageActionOptions = {}) {
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
        onComplete?.();
      }
    },
    [
      log,
      logError,
      login,
      onComplete,
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
