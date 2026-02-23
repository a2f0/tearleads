import { randomUUID } from 'node:crypto';
import type { VfsKeySetupRequest } from '@tearleads/shared';
import {
  buildVfsPublicEncryptionKey,
  encryptVfsPrivateKeysWithPassword,
  generateKeyPair,
  serializeKeyPair
} from '@tearleads/shared';
import { buildRevenueCatAppUserId } from '../billing.js';
import {
  buildPersonalOrganizationId,
  buildPersonalOrganizationName
} from '../createAccount.js';
import { hashPassword } from '../passwords.js';

export interface HarnessSqlClient {
  query(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface SeedHarnessAccountInput {
  email: string;
  password: string;
  admin?: boolean;
  emailConfirmed?: boolean;
  includeVfsOnboardingKeys?: boolean;
}

export interface SeedHarnessAccountResult {
  userId: string;
  personalOrganizationId: string;
  createdVfsOnboardingKeys: boolean;
}

async function buildVfsKeySetupFromPassword(
  password: string
): Promise<VfsKeySetupRequest> {
  const keyPair = generateKeyPair();
  const serializedKeyPair = serializeKeyPair(keyPair);
  const encryptedPrivateKeys = await encryptVfsPrivateKeysWithPassword(
    serializedKeyPair,
    password
  );

  return {
    publicEncryptionKey: buildVfsPublicEncryptionKey(keyPair),
    publicSigningKey: '',
    encryptedPrivateKeys: encryptedPrivateKeys.encryptedPrivateKeys,
    argon2Salt: encryptedPrivateKeys.argon2Salt
  };
}

export async function seedHarnessAccount(
  client: HarnessSqlClient,
  input: SeedHarnessAccountInput
): Promise<SeedHarnessAccountResult> {
  const admin = input.admin ?? false;
  const emailConfirmed = input.emailConfirmed ?? false;
  const includeVfsOnboardingKeys = input.includeVfsOnboardingKeys ?? true;

  const existingUser = await client.query(
    'SELECT id FROM users WHERE email = $1 LIMIT 1',
    [input.email]
  );
  const existingUserId = existingUser.rows[0]?.['id'];
  if (existingUserId) {
    throw new Error(`Account already exists for ${input.email}.`);
  }

  const userId = randomUUID();
  const personalOrganizationId = buildPersonalOrganizationId(userId);
  const personalOrganizationName = buildPersonalOrganizationName(userId);
  const revenueCatAppUserId = buildRevenueCatAppUserId(personalOrganizationId);
  const { salt, hash } = await hashPassword(input.password);
  const now = new Date().toISOString();
  const vfsKeySetup = includeVfsOnboardingKeys
    ? await buildVfsKeySetupFromPassword(input.password)
    : null;

  await client.query(
    `INSERT INTO users (
       id,
       email,
       email_confirmed,
       admin,
       personal_organization_id,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [userId, input.email, emailConfirmed, admin, personalOrganizationId, now]
  );

  await client.query(
    `INSERT INTO organizations (
       id,
       name,
       description,
       is_personal,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, true, $4, $4)`,
    [
      personalOrganizationId,
      personalOrganizationName,
      `Personal organization for ${input.email}`,
      now
    ]
  );

  await client.query(
    `INSERT INTO user_organizations (user_id, organization_id, joined_at, is_admin)
     VALUES ($1, $2, $3, true)`,
    [userId, personalOrganizationId, now]
  );

  await client.query(
    `INSERT INTO organization_billing_accounts (
       organization_id,
       revenuecat_app_user_id,
       entitlement_status,
       created_at,
       updated_at
     )
     VALUES ($1, $2, 'inactive', $3, $3)`,
    [personalOrganizationId, revenueCatAppUserId, now]
  );

  await client.query(
    `INSERT INTO user_credentials (
       user_id,
       password_hash,
       password_salt,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $4)`,
    [userId, hash, salt, now]
  );

  if (vfsKeySetup) {
    await client.query(
      `INSERT INTO user_keys (
         user_id,
         public_encryption_key,
         public_signing_key,
         encrypted_private_keys,
         argon2_salt,
         created_at
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        vfsKeySetup.publicEncryptionKey,
        vfsKeySetup.publicSigningKey ?? '',
        vfsKeySetup.encryptedPrivateKeys,
        vfsKeySetup.argon2Salt,
        now
      ]
    );
  }

  return {
    userId,
    personalOrganizationId,
    createdVfsOnboardingKeys: vfsKeySetup !== null
  };
}
