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
} from '@tearleads/shared';
export type { KeyManagerConfig, StoredKeyData } from './keyManager';
export {
  clearAllKeyManagers,
  clearKeyManagerForInstance,
  getCurrentInstanceId,
  getKeyManager,
  getKeyManagerForInstance,
  KeyManager,
  setCurrentInstanceId
} from './keyManager';
