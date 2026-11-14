import { useCallback } from "react";
import { useTearleads } from "../sdk/TearleadsProvider";
import { useDatabase } from "./DatabaseProvider";
import {
  type BackupProgress,
  createBackupPayload,
  restoreBackupPayload,
} from "./localBackupData";
import {
  type BackupSummary,
  createBackupFileName,
  decodeBackupFile,
  encodeBackupFile,
} from "./localBackupFormat";

export type { BackupProgress } from "./localBackupData";
export type { BackupSummary } from "./localBackupFormat";
export { backupFileRequiresPassword } from "./localBackupFormat";

interface LocalBackupOperationInput {
  readonly onProgress?: ((progress: BackupProgress) => void) | undefined;
  readonly password?: string | undefined;
}

interface ExportLocalBackupInput extends LocalBackupOperationInput {}

interface RestoreLocalBackupInput extends LocalBackupOperationInput {
  readonly text: string;
}

interface ExportLocalBackupResult {
  readonly fileName: string;
  readonly summary: BackupSummary;
  readonly text: string;
}

export function useLocalBackupOperations() {
  const database = useDatabase();
  const tearleads = useTearleads();

  const resolveRuntime = useCallback(async () => {
    const signingFingerprint = tearleads.identity.signingFingerprint;
    if (!signingFingerprint || !tearleads.identity.signingKeyPair) {
      throw new Error("Local identity is not ready for backup or restore.");
    }
    await database.ensureIdentityReady(signingFingerprint);
    if (
      tearleads.identity.signingFingerprint !== signingFingerprint ||
      !tearleads.identity.signingKeyPair
    ) {
      throw new Error("Local identity changed during backup or restore.");
    }

    return {
      blobStore: tearleads.blobs.store,
      databaseId: tearleads.database.id,
      executor: tearleads.database.requireExecSql("Backup / restore"),
      signingFingerprint,
    };
  }, [database, tearleads]);

  const exportLocalBackup = useCallback(
    async ({
      onProgress,
      password,
    }: ExportLocalBackupInput): Promise<ExportLocalBackupResult> => {
      const runtime = await resolveRuntime();
      const payload = await createBackupPayload({
        blobStore: runtime.blobStore,
        databaseId: runtime.databaseId,
        execSql: runtime.executor,
        onProgress,
        signingFingerprint: runtime.signingFingerprint,
      });
      if (password !== undefined) {
        onProgress?.({ current: 0, phase: "encrypting", total: 1 });
      }

      return {
        fileName: createBackupFileName(payload),
        summary: payload.summary,
        text: await encodeBackupFile({ password, payload }),
      };
    },
    [resolveRuntime],
  );

  const restoreLocalBackup = useCallback(
    async ({
      onProgress,
      password,
      text,
    }: RestoreLocalBackupInput): Promise<BackupSummary> => {
      onProgress?.({ current: 0, phase: "preparing", total: 1 });
      const payload = await decodeBackupFile({
        onDecrypt: () =>
          onProgress?.({ current: 0, phase: "decrypting", total: 1 }),
        password,
        text,
      });
      const runtime = await resolveRuntime();

      return restoreBackupPayload({
        blobStore: runtime.blobStore,
        execSql: runtime.executor,
        onProgress,
        payload,
        securityIncidents: tearleads.securityIncidents,
      });
    },
    [resolveRuntime, tearleads],
  );

  return { exportLocalBackup, restoreLocalBackup };
}
