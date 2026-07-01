import type { ApiClient } from "@tearleads/api-client";
import type { PutKeyPackageBackupRequest } from "@tearleads/validators/request";
import type {
  KeyPackageBackupResponse,
  ListKeyPackageBackupsResponse,
} from "@tearleads/validators/response";

export interface KeyPackageBackups {
  delete(backupId: string): Promise<boolean>;
  getByCredentialId(
    credentialId: string,
  ): Promise<KeyPackageBackupResponse | null>;
  list(): Promise<ListKeyPackageBackupsResponse["backups"]>;
  put(
    input: PutKeyPackageBackupRequest,
  ): Promise<KeyPackageBackupResponse | null>;
}

export function createKeyPackageBackups(api: ApiClient): KeyPackageBackups {
  return {
    async delete(backupId) {
      const response = await api.deleteKeyPackageBackup(backupId);
      return response?.message === "ok";
    },
    getByCredentialId(credentialId) {
      return api.getKeyPackageBackupByCredentialId(credentialId);
    },
    async list() {
      const response = await api.listKeyPackageBackups();
      return response?.backups ?? [];
    },
    put(input) {
      return api.putKeyPackageBackup(input);
    },
  };
}
