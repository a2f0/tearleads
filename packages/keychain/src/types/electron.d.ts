/**
 * Type declarations for Electron preload APIs exposed on window.
 * Subset of the full Electron API relevant to key management.
 */

export interface ElectronSqliteApi {
  getSalt?: (instanceId: string) => Promise<number[] | null>;
  setSalt?: (salt: number[], instanceId: string) => Promise<void>;
  getKeyCheckValue?: (instanceId: string) => Promise<string | null>;
  setKeyCheckValue?: (kcv: string, instanceId: string) => Promise<void>;
  getPasswordWrappedKey?: (instanceId: string) => Promise<number[] | null>;
  setPasswordWrappedKey?: (
    wrappedKey: number[],
    instanceId: string
  ) => Promise<void>;
  clearKeyStorage?: (instanceId: string) => Promise<void>;
  getWrappingKey?: (instanceId: string) => Promise<number[] | null>;
  setWrappingKey?: (keyBytes: number[], instanceId: string) => Promise<void>;
  getWrappedKey?: (instanceId: string) => Promise<number[] | null>;
  setWrappedKey?: (wrappedKey: number[], instanceId: string) => Promise<void>;
  hasSession?: (instanceId: string) => Promise<boolean>;
  clearSession?: (instanceId: string) => Promise<void>;
}

export interface ElectronApi {
  sqlite?: ElectronSqliteApi;
}

declare global {
  interface Window {
    electron?: ElectronApi;
  }
}
