export type { KeyManagerConfig, StoredKeyData } from './key-manager';

export { getKeyManager, KeyManager } from './key-manager';
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
} from './web-crypto';
