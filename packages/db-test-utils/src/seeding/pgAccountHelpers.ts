import { randomBytes, scrypt } from 'node:crypto';

const REVENUECAT_APP_USER_PREFIX = 'org:';
const PERSONAL_ORGANIZATION_ID_PREFIX = 'personal-org-';
const SALT_LENGTH = 16;
const KEY_LENGTH = 64;

export function buildRevenueCatAppUserId(organizationId: string): string {
  return `${REVENUECAT_APP_USER_PREFIX}${organizationId}`;
}

export function buildPersonalOrganizationId(userId: string): string {
  return `${PERSONAL_ORGANIZATION_ID_PREFIX}${userId}`;
}

export function buildPersonalOrganizationName(userId: string): string {
  return `Personal ${userId}`;
}

function scryptAsync(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, derivedKey) => {
      if (error) {
        reject(error);
      } else {
        resolve(derivedKey);
      }
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
