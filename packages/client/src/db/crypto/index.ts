export {
  decrypt,
  decryptString,
  deriveKeyFromPassword,
  encrypt,
  encryptString,
  exportKey,
  generateRandomKey,
  generateSalt,
  importKey,
  secureZero
} from '@rapid/shared';
export type { KeyManagerConfig, StoredKeyData } from './key-manager';
export {
  clearAllKeyManagers,
  clearKeyManagerForInstance,
  getCurrentInstanceId,
  getKeyManager,
  getKeyManagerForInstance,
  KeyManager,
  setCurrentInstanceId
} from './key-manager';
