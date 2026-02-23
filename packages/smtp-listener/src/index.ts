export {
  createStoredEmail,
  generateEmailId,
  parseAddress
} from './lib/parser.js';
export { resolveRecipientUserIds } from './lib/recipientResolver.js';

export { createSmtpListener, type SmtpListener } from './lib/server.js';
export { createStorage, type EmailStorage } from './lib/storage.js';
export type {
  EncryptedBlobWriteResult,
  InboundBlobStore,
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
