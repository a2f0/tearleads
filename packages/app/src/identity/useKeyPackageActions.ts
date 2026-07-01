import { type ChangeEvent, useCallback, useRef, useState } from "react";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useLog } from "../providers/logging/LogProvider";
import { useTearleads } from "../providers/sdk/TearleadsProvider";
import {
  createAppKeyPackageBackup,
  createKeyPackageFileName,
  downloadKeyPackageFile,
  parseKeyPackageFileText,
  readAppKeyPackageSession,
} from "./keyPackageBackup";
import {
  createPasskeyProtectedKeyPackageBackup,
  decryptPasskeyProtectedKeyPackageBackup,
  discoverPasskeyKeyPackageBackupCredentialId,
  isPasskeyKeyPackageBackupSupported,
} from "./keyPackageBackupPasskey";

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

type PasskeyBackupBusyState = "backup" | "restore" | null;
type CryptoSessionState = ReturnType<typeof useCryptoSession>;
type IdentityState = ReturnType<typeof useIdentity>;
type LogState = ReturnType<typeof useLog>;
type TearleadsClient = ReturnType<typeof useTearleads>;

interface PasskeyBackupOperationState {
  readonly setBusy: (value: PasskeyBackupBusyState) => void;
  readonly setError: (value: string | null) => void;
  readonly setStatus: (value: string | null) => void;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Operation failed.";
}

function usePasskeyBackupToPasskeyAction({
  exportKeyPackage,
  log,
  logError,
  session,
  signingFingerprint,
  state,
  supported,
  tearleads,
}: {
  readonly exportKeyPackage: IdentityState["exportKeyPackage"];
  readonly log: LogState["log"];
  readonly logError: LogState["logError"];
  readonly session: Pick<
    CryptoSessionState,
    "containerId" | "organizationId" | "userId"
  >;
  readonly signingFingerprint: string | null;
  readonly state: PasskeyBackupOperationState;
  readonly supported: boolean;
  readonly tearleads: TearleadsClient;
}) {
  const { containerId, organizationId, userId } = session;
  const { setBusy, setError, setStatus } = state;

  return useCallback(async () => {
    setBusy("backup");
    setError(null);
    setStatus(null);
    try {
      if (!supported) {
        throw new Error(
          "Passkey PRF backups are not supported in this browser.",
        );
      }
      if (!signingFingerprint) {
        throw new Error("A signing key is required before creating a backup.");
      }

      const keyPackage = await createAppKeyPackageBackup({
        identity: { exportKeyPackage },
        session: { containerId, organizationId, userId },
      });
      const backup = await createPasskeyProtectedKeyPackageBackup({
        keyPackage,
        signingKeyFingerprint: signingFingerprint,
      });
      const stored = await tearleads.keyPackageBackups.put(backup);
      if (!stored) {
        throw new Error("Could not store passkey backup.");
      }

      setStatus("Passkey backup saved.");
      log("Passkey key package backup saved");
    } catch (operationError: unknown) {
      logError("Failed to save passkey key package backup", operationError);
      setError(readErrorMessage(operationError));
    } finally {
      setBusy(null);
    }
  }, [
    containerId,
    exportKeyPackage,
    log,
    logError,
    organizationId,
    setBusy,
    setError,
    setStatus,
    signingFingerprint,
    supported,
    tearleads,
    userId,
  ]);
}

function usePasskeyRestoreFromPasskeyAction({
  log,
  logError,
  restoreKeyPackage,
  session,
  state,
  supported,
  tearleads,
}: {
  readonly log: LogState["log"];
  readonly logError: LogState["logError"];
  readonly restoreKeyPackage: IdentityState["restoreKeyPackage"];
  readonly session: Pick<
    CryptoSessionState,
    "login" | "setContainerId" | "setOrganizationId" | "setUserId"
  >;
  readonly state: PasskeyBackupOperationState;
  readonly supported: boolean;
  readonly tearleads: TearleadsClient;
}) {
  const { login, setContainerId, setOrganizationId, setUserId } = session;
  const { setBusy, setError, setStatus } = state;

  return useCallback(async () => {
    setBusy("restore");
    setError(null);
    setStatus(null);
    try {
      if (!supported) {
        throw new Error(
          "Passkey PRF backups are not supported in this browser.",
        );
      }

      const credentialId = await discoverPasskeyKeyPackageBackupCredentialId();
      const backup =
        await tearleads.keyPackageBackups.getByCredentialId(credentialId);
      if (!backup) {
        throw new Error(
          "No key package backup is registered for this passkey.",
        );
      }

      const keyPackage = await decryptPasskeyProtectedKeyPackageBackup(backup);
      await restoreKeyPackage(keyPackage);

      const parsedSession = readAppKeyPackageSession(keyPackage);
      if (parsedSession) {
        setContainerId(parsedSession.containerId);
        setOrganizationId(parsedSession.organizationId);
        setUserId(parsedSession.userId);
        await login();
      }

      setStatus("Passkey backup restored.");
      log("Passkey key package backup restored");
    } catch (operationError: unknown) {
      logError("Failed to restore passkey key package backup", operationError);
      setError(readErrorMessage(operationError));
    } finally {
      setBusy(null);
    }
  }, [
    log,
    logError,
    login,
    restoreKeyPackage,
    setBusy,
    setContainerId,
    setError,
    setOrganizationId,
    setStatus,
    setUserId,
    supported,
    tearleads,
  ]);
}

export function usePasskeyKeyPackageBackupActions() {
  const tearleads = useTearleads();
  const session = useCryptoSession();
  const { exportKeyPackage, restoreKeyPackage, signingFingerprint } =
    useIdentity();
  const { log, logError } = useLog();
  const [busy, setBusy] = useState<PasskeyBackupBusyState>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const state = { setBusy, setError, setStatus };
  const supported = isPasskeyKeyPackageBackupSupported();
  const backupToPasskey = usePasskeyBackupToPasskeyAction({
    exportKeyPackage,
    log,
    logError,
    session,
    signingFingerprint,
    state,
    supported,
    tearleads,
  });
  const restoreFromPasskey = usePasskeyRestoreFromPasskeyAction({
    log,
    logError,
    restoreKeyPackage,
    session,
    state,
    supported,
    tearleads,
  });

  return {
    backupToPasskey,
    busy,
    error,
    restoreFromPasskey,
    status,
    supported,
  };
}
