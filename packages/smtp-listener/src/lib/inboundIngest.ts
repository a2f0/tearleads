import { createCipheriv, randomBytes } from 'node:crypto';
import {
  combineEncapsulation,
  deserializePublicKey,
  splitPublicKey,
  wrapKeyForRecipient
} from '@tearleads/shared';
import type { StoredEmail } from '../types/email.js';
import type {
  InboundBlobStore,
  InboundMessageIngestor,
  InboundRecipientKeyLookup,
  InboundVfsEmailRepository,
  RecipientKeyRecord,
  ResolvedInboundRecipient,
  WrappedRecipientKeyEnvelope
} from '../types/inboundContracts.js';

const NONCE_BYTES = 12;

function extractSubject(rawData: string): string {
  const lines = rawData.split('\n');
  for (const line of lines) {
    if (line.toLowerCase().startsWith('subject:')) {
      return line.slice(8).trim();
    }
    if (line.trim().length === 0) {
      break;
    }
  }
  return '';
}

function parseUserIdFromAddress(address: string): string | null {
  const normalized = address.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex <= 0) {
    return null;
  }
  return normalized.slice(0, atIndex);
}

interface ResolvedRecipientWithKey {
  recipient: ResolvedInboundRecipient;
  publicEncryptionKey: string;
}

function resolveRecipients(
  email: StoredEmail,
  userIds: string[],
  keyRecords: Map<string, RecipientKeyRecord>
): ResolvedRecipientWithKey[] {
  const resolved: ResolvedRecipientWithKey[] = [];
  for (const userId of userIds) {
    let matchedAddress = `${userId}@unknown`;
    for (const recipient of email.envelope.rcptTo) {
      const parsed = parseUserIdFromAddress(recipient.address);
      if (parsed === userId) {
        matchedAddress = recipient.address;
        break;
      }
    }
    const keyRecord = keyRecords.get(userId);
    if (!keyRecord) {
      throw new Error(`Missing recipient key for user ${userId}`);
    }
    resolved.push({
      recipient: {
        userId,
        address: matchedAddress,
        organizationId: keyRecord.organizationId
      },
      publicEncryptionKey: keyRecord.publicEncryptionKey
    });
  }
  return resolved;
}

function encryptBytesAesGcm(
  plaintext: Uint8Array,
  dek: Uint8Array
): Uint8Array {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', dek, nonce);
  const encryptedPart1 = cipher.update(plaintext);
  const encryptedPart2 = cipher.final();
  const authTag = cipher.getAuthTag();

  const merged = new Uint8Array(
    nonce.byteLength +
      authTag.byteLength +
      encryptedPart1.byteLength +
      encryptedPart2.byteLength
  );
  let offset = 0;
  merged.set(nonce, offset);
  offset += nonce.byteLength;
  merged.set(authTag, offset);
  offset += authTag.byteLength;
  merged.set(encryptedPart1, offset);
  offset += encryptedPart1.byteLength;
  merged.set(encryptedPart2, offset);
  return merged;
}

function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

function wrapDekForRecipients(input: {
  dek: Uint8Array;
  recipientKeys: Array<{ userId: string; publicEncryptionKey: string }>;
}): WrappedRecipientKeyEnvelope[] {
  const wrapped: WrappedRecipientKeyEnvelope[] = [];
  for (const entry of input.recipientKeys) {
    const publicKey = deserializePublicKey(
      splitPublicKey(entry.publicEncryptionKey)
    );
    const wrappedDek = combineEncapsulation(
      wrapKeyForRecipient(input.dek, publicKey)
    );
    wrapped.push({
      userId: entry.userId,
      wrappedDek,
      keyAlgorithm: 'x25519-mlkem768-hybrid-v1'
    });
  }
  return wrapped;
}

export class DefaultInboundMessageIngestor implements InboundMessageIngestor {
  constructor(
    private readonly keyLookup: InboundRecipientKeyLookup,
    private readonly blobStore: InboundBlobStore,
    private readonly repository: InboundVfsEmailRepository
  ) {}

  async ingest(input: {
    email: StoredEmail;
    userIds: string[];
  }): Promise<void> {
    if (input.userIds.length === 0) {
      return;
    }

    const keyRecords = await this.keyLookup.getPublicEncryptionKeys(
      input.userIds
    );
    const resolvedWithKeys = resolveRecipients(
      input.email,
      input.userIds,
      keyRecords
    );
    const recipients = resolvedWithKeys.map((r) => r.recipient);

    const dek = randomBytes(32);
    try {
      const encryptedRawData = encryptBytesAesGcm(
        new TextEncoder().encode(input.email.rawData),
        dek
      );
      const blob = await this.blobStore.putEncryptedMessage({
        messageId: input.email.id,
        ciphertext: encryptedRawData,
        contentType: 'application/octet-stream'
      });
      const wrappedRecipientKeys = wrapDekForRecipients({
        dek,
        recipientKeys: resolvedWithKeys.map((r) => ({
          userId: r.recipient.userId,
          publicEncryptionKey: r.publicEncryptionKey
        }))
      });

      const subject = extractSubject(input.email.rawData);
      const fromText = input.email.envelope.mailFrom
        ? input.email.envelope.mailFrom.address
        : '';
      const toText = input.email.envelope.rcptTo.map((r) => r.address);

      await this.repository.persistInboundMessage({
        envelope: {
          messageId: input.email.id,
          from: input.email.envelope.mailFrom,
          to: input.email.envelope.rcptTo,
          receivedAt: input.email.receivedAt,
          encryptedSubject: toBase64(
            encryptBytesAesGcm(new TextEncoder().encode(subject), dek)
          ),
          encryptedFrom: toBase64(
            encryptBytesAesGcm(new TextEncoder().encode(fromText), dek)
          ),
          encryptedTo: toText.map((address) =>
            toBase64(encryptBytesAesGcm(new TextEncoder().encode(address), dek))
          ),
          encryptedBodyPointer: blob.storageKey,
          encryptedBodySha256: blob.sha256,
          encryptedBodySize: blob.ciphertextSize,
          wrappedRecipientKeys
        },
        recipients
      });
    } finally {
      dek.fill(0);
    }
  }
}
