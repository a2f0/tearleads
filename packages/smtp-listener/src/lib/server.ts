import { SMTPServer, type SMTPServerSession } from 'smtp-server';
import type {
  EmailAddress,
  EmailEnvelope,
  SmtpListenerConfig
} from '../types/email.js';
import { createStoredEmail } from './parser.js';
import { createStorage, type EmailStorage } from './storage.js';

export interface SmtpListener {
  start(): Promise<void>;
  stop(): Promise<void>;
  getPort(): number;
}

function toEmailAddress(
  addr: { address: string; name?: string } | undefined
): EmailAddress | false {
  if (!addr) {
    return false;
  }
  return addr.name
    ? { address: addr.address, name: addr.name }
    : { address: addr.address };
}

function buildEnvelope(session: SMTPServerSession): EmailEnvelope {
  const mailFrom = toEmailAddress(
    session.envelope.mailFrom as { address: string; name?: string } | undefined
  );
  const rcptTo = (
    session.envelope.rcptTo as Array<{ address: string; name?: string }>
  ).map((r) =>
    r.name ? { address: r.address, name: r.name } : { address: r.address }
  );
  return { mailFrom, rcptTo };
}

export async function createSmtpListener(
  config: SmtpListenerConfig
): Promise<SmtpListener> {
  const redisUrl = config.redisUrl ?? 'redis://localhost:6379';
  let storage: EmailStorage | null = null;

  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    size: config.maxMessageSize ?? 10 * 1024 * 1024,
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];

      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      stream.on('end', () => {
        const rawData = Buffer.concat(chunks).toString('utf8');
        const envelope = buildEnvelope(session);
        const email = createStoredEmail(envelope, rawData);

        const processEmail = async (): Promise<void> => {
          if (storage) {
            await storage.store(email);
          }
          if (config.onEmail) {
            await config.onEmail(email);
          }
        };

        processEmail()
          .then(() => callback())
          .catch((err: unknown) => {
            const error = err instanceof Error ? err : new Error(String(err));
            callback(error);
          });
      });

      stream.on('error', (err: Error) => {
        callback(err);
      });
    }
  });

  let actualPort = config.port;

  return {
    async start(): Promise<void> {
      storage = await createStorage(redisUrl);
      return new Promise((resolve, reject) => {
        server.listen(config.port, config.host, () => {
          const address = server.server.address();
          if (address && typeof address === 'object') {
            actualPort = address.port;
          }
          resolve();
        });
        server.on('error', reject);
      });
    },

    async stop(): Promise<void> {
      return new Promise((resolve) => {
        server.close(() => {
          if (storage) {
            storage
              .close()
              .then(resolve)
              .catch(() => resolve());
          } else {
            resolve();
          }
        });
      });
    },

    getPort(): number {
      return actualPort;
    }
  };
}
