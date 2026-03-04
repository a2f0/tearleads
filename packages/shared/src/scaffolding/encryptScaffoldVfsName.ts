import {
  combineEncapsulation,
  deserializePublicKey,
  splitPublicKey,
  wrapKeyForRecipient
} from '../crypto/asymmetric.js';
import { encrypt, importKey } from '../crypto/webCrypto.js';

interface DbQueryClient {
  query(
    text: string,
    params?: readonly unknown[]
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

interface EncryptScaffoldVfsNameInput {
  client: DbQueryClient;
  ownerUserId: string;
  plaintextName: string;
  allowOwnerWrappedSessionKey?: boolean;
}

export interface EncryptScaffoldVfsNameResult {
  encryptedSessionKey: string;
  encryptedName: string;
}

function readOptionalPublicEncryptionKey(
  rows: Array<Record<string, unknown>>
): string | null {
  const publicEncryptionKey = rows[0]?.['public_encryption_key'];
  if (typeof publicEncryptionKey !== 'string') {
    return null;
  }
  const trimmed = publicEncryptionKey.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

export async function encryptScaffoldVfsName(
  input: EncryptScaffoldVfsNameInput
): Promise<EncryptScaffoldVfsNameResult> {
  let publicEncryptionKey: string | null = null;
  if (input.allowOwnerWrappedSessionKey === true) {
    const keyRows = await input.client.query(
      `SELECT public_encryption_key
         FROM user_keys
        WHERE user_id = $1
        LIMIT 1`,
      [input.ownerUserId]
    );
    publicEncryptionKey = readOptionalPublicEncryptionKey(keyRows.rows);
  }

  const sessionKey = crypto.getRandomValues(new Uint8Array(32));
  try {
    const encryptedSessionKey = publicEncryptionKey
      ? combineEncapsulation(
          wrapKeyForRecipient(
            sessionKey,
            deserializePublicKey(splitPublicKey(publicEncryptionKey))
          )
        )
      : `scaffold-unwrapped:${Buffer.from(sessionKey).toString('base64')}`;
    const cryptoKey = await importKey(sessionKey);
    const encryptedNameBytes = await encrypt(
      new TextEncoder().encode(input.plaintextName),
      cryptoKey
    );

    return {
      encryptedSessionKey,
      encryptedName: Buffer.from(encryptedNameBytes).toString('base64')
    };
  } finally {
    sessionKey.fill(0);
  }
}
