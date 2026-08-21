import { useCallback } from "react";
import { useSymCrypt } from "../sdk/SymCryptProvider";
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

interface LocalBackupOperationInput {
  readonly onProgress?: ((progress: BackupProgress) => void) | undefined;
  readonly password: string;
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
  const symcrypt = useSymCrypt();

  const resolveRuntime = useCallback(async () => {
    await database.ensureReady();

    return {
      blobStore: symcrypt.blobs.store,
      databaseId: symcrypt.database.id,
      executor: symcrypt.database.requireExecSql("Backup / restore"),
      signingFingerprint: symcrypt.identity.signingFingerprint,
    };
  }, [database, symcrypt]);

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
      onProgress?.({ current: 0, phase: "encrypting", total: 1 });

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
      onProgress?.({ current: 0, phase: "decrypting", total: 1 });
      const payload = await decodeBackupFile({ password, text });
      const runtime = await resolveRuntime();

      return restoreBackupPayload({
        blobStore: runtime.blobStore,
        execSql: runtime.executor,
        onProgress,
        payload,
      });
    },
    [resolveRuntime],
  );

  return { exportLocalBackup, restoreLocalBackup };
}
