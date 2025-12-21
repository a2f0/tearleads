export type { KeyManagerConfig, StoredKeyData } from './key-manager';

export { getKeyManager, KeyManager } from './key-manager';
export {
  decrypt,
  decryptPage,
  decryptString,
  deriveKeyFromPassword,
  encrypt,
  encryptPage,
  encryptString,
  exportKey,
  generateRandomKey,
  generateSalt,
  importKey,
  secureZero
} from './web-crypto';
