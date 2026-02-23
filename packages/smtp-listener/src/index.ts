export {
  createStoredEmail,
  generateEmailId,
  parseAddress
} from './lib/parser.js';
export { S3InboundBlobStore } from './lib/inboundBlobStore.js';
export { DefaultInboundMessageIngestor } from './lib/inboundIngest.js';
export { PostgresInboundRecipientKeyLookup } from './lib/inboundKeyLookup.js';
export { PostgresInboundVfsEmailRepository } from './lib/inboundVfsRepository.js';
export { closePostgresPool, getPostgresPool } from './lib/postgres.js';
export { resolveRecipientUserIds } from './lib/recipientResolver.js';

export { createSmtpListener, type SmtpListener } from './lib/server.js';
export { createStorage, type EmailStorage } from './lib/storage.js';
export type {
  EncryptedBlobWriteResult,
  InboundBlobStore,
  InboundMessageIngestor,
  InboundMessageEnvelopeRecord,
  InboundRecipientKeyLookup,
  InboundVfsEmailRepository,
  RecipientKeyRecord,
  ResolvedInboundRecipient,
  WrappedRecipientKeyEnvelope
} from './lib/inboundContracts.js';
export type {
  EmailAddress,
  EmailEnvelope,
  SmtpListenerConfig,
  StoredEmail
} from './types/email.js';
