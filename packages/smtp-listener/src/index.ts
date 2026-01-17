export {
  createStoredEmail,
  generateEmailId,
  parseAddress
} from './lib/parser.js';

export { createSmtpListener, type SmtpListener } from './lib/server.js';
export { createStorage, type EmailStorage } from './lib/storage.js';
export type {
  EmailAddress,
  EmailEnvelope,
  SmtpListenerConfig,
  StoredEmail
} from './types/email.js';
