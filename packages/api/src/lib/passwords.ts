import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;

function scryptAsync(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      if (!Buffer.isBuffer(derivedKey)) {
        reject(new Error('Invalid scrypt output'));
        return;
      }
      resolve(derivedKey);
    });
  });
}

export async function hashPassword(
  password: string
): Promise<{ salt: string; hash: string }> {
  const salt = randomBytes(SALT_LENGTH).toString('base64');
  const derivedKey = await scryptAsync(password, salt);
  return { salt, hash: derivedKey.toString('base64') };
}

export async function verifyPassword(
  password: string,
  salt: string,
  hash: string
): Promise<boolean> {
  const derivedKey = await scryptAsync(password, salt);
  const hashBuffer = Buffer.from(hash, 'base64');
  if (hashBuffer.length !== derivedKey.length) {
    return false;
  }
  return timingSafeEqual(hashBuffer, derivedKey);
}
