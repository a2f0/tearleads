import type { EmailAddress } from '../types/email.js';

export interface ResolvedInboundRecipient {
  userId: string;
  address: string;
}

export interface RecipientKeyRecord {
  userId: string;
  publicEncryptionKey: string;
}

export interface InboundRecipientKeyLookup {
  getPublicEncryptionKeys(
    userIds: string[]
  ): Promise<Map<string, RecipientKeyRecord>>;
}

export interface EncryptedBlobWriteResult {
  storageKey: string;
  sha256: string;
  ciphertextSize: number;
}

export interface InboundBlobStore {
  putEncryptedMessage(input: {
    messageId: string;
    ciphertext: Uint8Array;
    contentType: string;
  }): Promise<EncryptedBlobWriteResult>;
}

export interface WrappedRecipientKeyEnvelope {
  userId: string;
  wrappedDek: string;
  keyAlgorithm: string;
}

export interface InboundMessageEnvelopeRecord {
  messageId: string;
  from: EmailAddress | false;
  to: EmailAddress[];
  receivedAt: string;
  encryptedSubject: string;
  encryptedBodyPointer: string;
  wrappedRecipientKeys: WrappedRecipientKeyEnvelope[];
}

export interface InboundVfsEmailRepository {
  persistInboundMessage(input: {
    envelope: InboundMessageEnvelopeRecord;
    recipients: ResolvedInboundRecipient[];
  }): Promise<void>;
}
